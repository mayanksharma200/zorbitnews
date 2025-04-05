import express from "express";
import mongoose from "mongoose";
import axios from "axios";
import dotenv from "dotenv";
import cors from "cors";
import compression from "compression";
import helmet from "helmet";

// Load environment variables
dotenv.config({ path: "../.env" });
const app = express();
const port = process.env.PORT || 3000;

// API Configuration
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_URL =
  process.env.GEMINI_API_URL ||
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent";
const CRON_SECRET = process.env.CRON_SECRET; // Required for cron-job.org authentication
const SERPAPI_KEY = process.env.SERPAPI_KEY; // Required for news fetching
const MONGODB_URI = process.env.MONGODB_URI; // Required for database connection

// ==============================================
// Database Models
// ==============================================

// Lock Schema for distributed locking
const lockSchema = new mongoose.Schema(
  {
    jobName: {
      type: String,
      required: true,
      unique: true,
    },
    lockedAt: {
      type: Date,
      default: Date.now,
    },
    lockedBy: {
      type: String,
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
  },
  { timestamps: false }
);

const Lock = mongoose.model("Lock", lockSchema);

// News Article Schema
const newsSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: "",
    },
    link: {
      type: String,
      required: true,
      unique: true,
    },
    image: {
      type: String,
      validate: {
        validator: (v) => v === null || /^(https?:\/\/).+/.test(v),
        message: (props) => `${props.value} is not a valid image URL!`,
      },
    },
    source: {
      type: String,
      required: true,
    },
    date: {
      type: String,
      required: true,
    },
    query: {
      type: String,
      required: true,
      index: true,
    },
    fetchedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: false,
    versionKey: false,
  }
);

const News = mongoose.model("News", newsSchema);

// ==============================================
// Middleware
// ==============================================

if (process.env.NODE_ENV === "production") {
  app.use(compression());
  app.use(helmet());
}

app.use(
  cors({
    origin: ["https://news-hub-app-six.vercel.app", "http://localhost:5173"],
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
    credentials: true,
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ==============================================
// Helper Functions
// ==============================================

async function fetchWithRetry(url, config = {}, retries = 3) {
  try {
    const response = await axios({
      url,
      timeout: 15000,
      ...config,
      headers: {
        "Content-Type": "application/json",
        ...config.headers,
      },
    });
    return response.data;
  } catch (error) {
    if (retries > 0) {
      console.log(`Retrying... (${retries} attempts left)`);
      await new Promise((resolve) =>
        setTimeout(resolve, 1000 * (3 - retries + 1))
      );
      return fetchWithRetry(url, config, retries - 1);
    }
    throw error;
  }
}

function validateGeminiResponse(response) {
  if (!response?.candidates?.[0]?.content?.parts?.[0]?.text) {
    throw new Error("Invalid response structure from Gemini API");
  }
  return response.candidates[0].content.parts[0].text;
}

// ==============================================
// News Update Service
// ==============================================

class NewsUpdater {
  static async fetchFromSerpAPI(query, num) {
    try {
      const { data } = await axios.get("https://serpapi.com/search.json", {
        params: {
          engine: "google_news",
          q: query,
          api_key: SERPAPI_KEY,
          num: parseInt(num),
        },
        timeout: 10000,
      });
      return data.news_results || [];
    } catch (error) {
      console.error(`SerpAPI fetch failed for ${query}:`, error.message);
      return [];
    }
  }

  static async updateDatabase() {
    const instanceId = `cron-job_${Date.now()}`;
    const lockName = "news_update_job";

    console.log(`[${new Date().toISOString()}] Attempting to acquire lock...`);

    const lockAcquired = await LockManager.acquire(lockName, instanceId);
    if (!lockAcquired) {
      console.log("Update skipped (already in progress by another process)");
      return;
    }

    try {
      console.log(`[${new Date().toISOString()}] Starting news update`);

      const updateCategories = [
        { query: "india news", count: 20 },
        { query: "technology", count: 15 },
        { query: "business", count: 15 },
        { query: "sports", count: 15 },
      ];

      for (const { query, count } of updateCategories) {
        console.log(`Fetching ${query} articles...`);
        const articles = await this.fetchFromSerpAPI(query, count);

        if (articles.length === 0) {
          console.log(`No articles found for ${query}`);
          continue;
        }

        const bulkOps = articles.map((article) => ({
          updateOne: {
            filter: { link: article.link },
            update: {
              $set: {
                title: article.title || "No title available",
                description: article.snippet || "",
                link: article.link,
                image: article.thumbnail || null,
                source: article.source?.name || "Unknown source",
                date: article.date || new Date().toISOString().split("T")[0],
                query: query,
                fetchedAt: new Date(),
              },
            },
            upsert: true,
          },
        }));

        const result = await News.bulkWrite(bulkOps);
        console.log(
          `Updated ${query}: ${result.upsertedCount} new, ${result.modifiedCount} updated`
        );
      }
    } catch (error) {
      console.error("Update process failed:", error);
    } finally {
      await LockManager.release(lockName, instanceId);
      console.log(`[${new Date().toISOString()}] Update completed`);
    }
  }
}

// ==============================================
// Distributed Lock Manager
// ==============================================

class LockManager {
  static async acquire(jobName, instanceId, ttlMinutes = 5) {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMinutes * 60000);

    try {
      const result = await Lock.findOneAndUpdate(
        {
          jobName,
          $or: [{ expiresAt: { $lt: now } }, { expiresAt: { $exists: false } }],
        },
        {
          $set: {
            lockedAt: now,
            lockedBy: instanceId,
            expiresAt,
          },
        },
        {
          upsert: true,
          new: true,
          setDefaultsOnInsert: true,
        }
      );

      return result.lockedBy === instanceId;
    } catch (error) {
      console.error("Lock acquisition failed:", error);
      return false;
    }
  }

  static async release(jobName, instanceId) {
    try {
      await Lock.deleteOne({
        jobName,
        lockedBy: instanceId,
      });
    } catch (error) {
      console.error("Lock release failed:", error);
    }
  }

  static async getLockStatus(jobName) {
    return Lock.findOne({ jobName });
  }
}

// ==============================================
// API Endpoints
// ==============================================

// Health Check
app.get("/api/health", async (req, res) => {
  try {
    const dbStatus =
      mongoose.connection.readyState === 1 ? "connected" : "disconnected";
    const lastArticle = await News.findOne().sort({ fetchedAt: -1 });
    const lockStatus = await LockManager.getLockStatus("news_update_job");

    res.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      database: {
        status: dbStatus,
        lastUpdate: lastArticle?.fetchedAt || "never",
        documentCount: await News.estimatedDocumentCount(),
      },
      updateJob: {
        lastRun: lockStatus?.lockedAt || "never",
        lockedBy: lockStatus?.lockedBy || "none",
        expiresAt: lockStatus?.expiresAt || "n/a",
      },
      services: {
        gemini: !!GEMINI_API_KEY ? "operational" : "not_configured",
        serpapi: !!SERPAPI_KEY ? "operational" : "not_configured",
      },
    });
  } catch (error) {
    res.status(500).json({
      status: "degraded",
      error: error.message,
    });
  }
});

// Get News Articles
app.get("/api/news", async (req, res) => {
  try {
    const { query = "India news", num = 20 } = req.query;
    const numResults = Math.min(parseInt(num), 100);

    if (isNaN(numResults)) {
      return res.status(400).json({
        success: false,
        error: "Invalid number parameter",
      });
    }

    const articles = await News.find({ query })
      .sort({ fetchedAt: -1 })
      .limit(numResults)
      .lean();

    res.json({
      success: true,
      data: articles,
      meta: {
        count: articles.length,
        lastUpdated: articles[0]?.fetchedAt || null,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to fetch articles",
    });
  }
});

// Content Generation Endpoint (RESTORED)
app.post("/api/generate-story", async (req, res) => {
  try {
    const { title, source, imageUrl } = req.body;

    if (!title || !source) {
      return res.status(400).json({
        success: false,
        error: "Title and source are required fields",
      });
    }

    if (!GEMINI_API_KEY) {
      return res.status(501).json({
        success: false,
        error: "Content generation service not configured",
      });
    }

    const prompt = `As a journalist, write a detailed news article:\n\n
    HEADLINE: ${title}\n
    SOURCE: ${source}\n
    ${imageUrl ? `IMAGE: Consider this image: ${imageUrl}` : ""}\n\n
    ARTICLE REQUIREMENTS:
    - 9-10 paragraphs (800-1000 words)
    - Structured journalism format\n`;

    const response = await fetchWithRetry(
      `${GEMINI_API_URL}?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        data: {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
        },
      }
    );

    const content = validateGeminiResponse(response).trim();

    res.json({
      success: true,
      content: content || "No content was generated.",
    });
  } catch (error) {
    console.error("Content generation error:", error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Get Single Article (EXPLICITLY INCLUDED)
app.get("/api/article", async (req, res) => {
  try {
    const { url } = req.query;

    if (!url) {
      return res.status(400).json({
        success: false,
        error: "Article URL is required"
      });
    }

    const article = await News.findOne({ link: url }).lean();

    if (!article) {
      return res.status(404).json({
        success: false,
        error: "Article not found in database"
      });
    }

    res.json({
      success: true,
      article
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Database error"
    });
  }
});

// Cron-job.org Endpoint
app.post("/api/cron/update-news", async (req, res) => {
  // Verify the secret key
  if (req.headers["x-cron-secret"] !== CRON_SECRET) {
    return res.status(403).json({
      success: false,
      error: "Unauthorized",
    });
  }

  try {
    await NewsUpdater.updateDatabase();
    res.json({
      success: true,
      message: "News update completed",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

app.get("/api/debug/env", (req, res) => {
  res.json({
    dbConnected: mongoose.connection.readyState === 1,
    envVars: {
      MONGODB_URI: !!process.env.MONGODB_URI,
      CRON_SECRET: !!process.env.CRON_SECRET,
      SERPAPI_KEY: !!process.env.SERPAPI_KEY,
    },
  });
});
// ==============================================
// Server Initialization
// ==============================================

async function startServer() {
  try {
    // Database Connection
    await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
      maxPoolSize: 10,
    });

    mongoose.connection.on("connected", () => {
      console.log("MongoDB connected");
    });

    mongoose.connection.on("error", (err) => {
      console.error("MongoDB connection error:", err);
    });

    // Start HTTP Server
    app.listen(port, () => {
      console.log(`Server running on port ${port}`);
    });
  } catch (error) {
    console.error("Server startup failed:", error);
    process.exit(1);
  }
}

// Graceful Shutdown
process.on("SIGINT", async () => {
  try {
    await mongoose.connection.close();
    console.log("MongoDB connection closed");
    process.exit(0);
  } catch (error) {
    console.error("Shutdown error:", error);
    process.exit(1);
  }
});

startServer();

export default app;