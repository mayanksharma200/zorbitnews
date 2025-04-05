import express from "express";
import mongoose from "mongoose";
import axios from "axios";
import cron from "node-cron";
import dotenv from "dotenv";
import cors from "cors";
import compression from "compression";
import helmet from "helmet";

// Configuration
dotenv.config({ path: "../.env" });
const app = express();
const port = process.env.PORT || 3000;

// API Configuration
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_URL =
  process.env.GEMINI_API_URL ||
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent";
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES) || 3;

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
  {
    timestamps: false,
  }
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

// Create indexes
// newsSchema.index({ link: 1 }, { unique: true });
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
// Distributed Lock Manager
// ==============================================

class LockManager {
  static async acquire(jobName, instanceId, ttlMinutes = 5) {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMinutes * 60000);

    try {
      // Find and update any expired lock or create new one
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

      // Verify we got the lock
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
// Helper Functions
// ==============================================

async function fetchWithRetry(url, config = {}, retries = MAX_RETRIES) {
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
        setTimeout(resolve, 1000 * (MAX_RETRIES - retries + 1))
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
          api_key: process.env.SERPAPI_KEY,
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
    const instanceId =
      process.env.HOSTNAME || `local_${process.pid}_${Date.now()}`;
    const lockName = "news_update_job";

    console.log(`[${new Date().toISOString()}] Attempting to acquire lock...`);

    const lockAcquired = await LockManager.acquire(lockName, instanceId);
    if (!lockAcquired) {
      const currentLock = await LockManager.getLockStatus(lockName);
      console.log(
        `Update skipped. Currently locked by ${currentLock?.lockedBy} until ${currentLock?.expiresAt}`
      );
      return;
    }

    try {
      console.log(
        `[${new Date().toISOString()}] Starting news update as ${instanceId}`
      );

      const updateCategories = [
        { query: "india news", count: 100 },
        { query: "technology", count: 75 },
        { query: "business", count: 75 },
        { query: "sports", count: 75 },
      ];

      for (const { query, count } of updateCategories) {
        console.log(`Fetching ${query} articles...`);
        const articles = await NewsUpdater.fetchFromSerpAPI(query, count);

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
      console.log(
        `[${new Date().toISOString()}] Update completed by ${instanceId}`
      );
    }
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
    const { query = "India news", num = 75 } = req.query;
    const numResults = Math.min(parseInt(num), 150);

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

    const lastUpdated = articles[0]?.fetchedAt || null;
    const nextUpdate = new Date(Date.now() + 1 * 60 * 1000); // 5 minutes from now

    res.json({
      success: true,
      data: articles,
      meta: {
        count: articles.length,
        lastUpdated,
        nextUpdate: nextUpdate.toISOString(),
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Failed to fetch articles",
    });
  }
});

// Get Single Article
app.get("/api/article", async (req, res) => {
  try {
    const { url } = req.query;

    if (!url) {
      return res.status(400).json({
        success: false,
        error: "Article URL is required",
      });
    }

    const article = await News.findOne({ link: url }).lean();

    if (!article) {
      return res.status(404).json({
        success: false,
        error: "Article not found in database",
      });
    }

    res.json({
      success: true,
      article,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "Database error",
    });
  }
});

// Content Generation Endpoint (Gemini AI)
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

// Manual Update Trigger (for testing)
app.post("/api/admin/update-now", async (req, res) => {
  try {
    await NewsUpdater.updateDatabase();
    res.json({
      success: true,
      message: "Manual update triggered",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});


// ==============================================
// Server Initialization
// ==============================================

async function startServer() {
  try {
    // Database Connection
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
      maxPoolSize: 10,
    });

    mongoose.connection.on("connected", () => {
      console.log("MongoDB connected");
    });

    mongoose.connection.on("error", (err) => {
      console.error("MongoDB connection error:", err);
    });

    // Start Cron Job (every 5 minutes)
    // cron.schedule("*/30 * * * *", NewsUpdater.updateDatabase);
    console.log("Scheduled news updates every 30 minutes");

    // Initial update (delayed to let server start)
    // setTimeout(() => NewsUpdater.updateDatabase(), 15000);

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

// Start the application
startServer();

export default app;
