import express from "express";
import mongoose from "mongoose";
import axios from "axios";
import cors from "cors";
import dotenv from "dotenv";
import compression from "compression";
import helmet from "helmet";
import cron from "node-cron";

dotenv.config({ path: "../.env" });

const app = express();
const port = process.env.PORT || 3000;

// ======================
// MongoDB Schema Definition
// ======================
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
        validator: function (v) {
          return v === null || /^(https?:\/\/).+/.test(v);
        },
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

// Create model
const News = mongoose.model("News", newsSchema);

// ======================
// Middleware Configuration
// ======================
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

// ======================
// API Configuration
// ======================
const SERPAPI_KEY = process.env.SERPAPI_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_URL =
  process.env.GEMINI_API_URL ||
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent";
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES) || 3;

// ======================
// Helper Functions
// ======================
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

// ======================
// Scheduled Data Fetching
// ======================
const fetchAndStoreNews = async (query = "India news", num = 20) => {
  try {
    console.log(`Running scheduled API fetch for: ${query}`);
    const data = await fetchWithRetry("https://serpapi.com/search.json", {
      params: {
        engine: "google_news",
        q: query,
        api_key: SERPAPI_KEY,
        num: parseInt(num),
      },
    });

    const articles = (data.news_results || []).map((article) => ({
      title: article.title || "No title available",
      description: article.snippet || "",
      link: article.link,
      image: article.thumbnail || null,
      source: article.source?.name || "Unknown source",
      date: article.date || new Date().toISOString(),
      query: query,
      fetchedAt: new Date(),
    }));

    if (articles.length > 0) {
      const bulkOps = articles.map((article) => ({
        updateOne: {
          filter: { link: article.link },
          update: { $set: article },
          upsert: true,
        },
      }));

      await News.bulkWrite(bulkOps);
      console.log(`Stored ${articles.length} articles for query: ${query}`);
    }

    return articles;
  } catch (error) {
    console.error("Scheduled API fetch error:", error);
    return [];
  }
};

// Schedule regular API fetches (every 30 minutes)
cron.schedule("*/30 * * * *", async () => {
  await fetchAndStoreNews("India news", 20);
  await fetchAndStoreNews("Technology", 15);
  await fetchAndStoreNews("Business", 15);
  await fetchAndStoreNews("Sports", 15);
});

// ======================
// Database-Only Endpoints
// ======================

// 1. News from Database (no API fallback)
app.get("/api/news", async (req, res) => {
  try {
    const { query = "India news", num = 100 } = req.query;
    const numResults = Math.min(parseInt(num), 50);

    if (isNaN(numResults) || numResults < 1) {
      return res.status(400).json({
        success: false,
        error: "Number of results must be between 1 and 50",
      });
    }

    const dbArticles = await News.find({ query })
      .sort({ fetchedAt: -1 })
      .limit(numResults)
      .lean();

    if (dbArticles.length === 0) {
      return res.status(404).json({
        success: false,
        error: "No articles found in database. Next update in 6 hours.",
        nextUpdate: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      });
    }

    res.json({
      success: true,
      articles: dbArticles,
      count: dbArticles.length,
      lastUpdated: dbArticles[0].fetchedAt,
      nextUpdate: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    });
  } catch (error) {
    console.error("Database query error:", error.message);
    res.status(500).json({
      success: false,
      error: "Failed to fetch news from database",
    });
  }
});

// 2. Article Detail from Database
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
    console.error("Article endpoint error:", error.message);
    res.status(500).json({
      success: false,
      error: "Database error",
    });
  }
});

// 3. Content Generation Endpoint (Gemini AI)
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
    ARTICLE REQUIREMENTS:\n- 9-10 paragraphs (800-1000 words)\n- Structured journalism format\n`;

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
    console.error("Generation error:", error.message);
    res.status(500).json({
      success: false,
      error: "Failed to generate content",
    });
  }
});

// 4. Health Check Endpoint
app.get("/api/health", async (req, res) => {
  try {
    const dbStatus =
      mongoose.connection.readyState === 1 ? "connected" : "disconnected";
    const lastArticle = await News.findOne().sort({ fetchedAt: -1 });

    res.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      database: {
        status: dbStatus,
        lastUpdate: lastArticle?.fetchedAt || "never",
        nextUpdate: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      },
      services: {
        serpapi: !!SERPAPI_KEY ? "operational" : "not_configured",
        gemini: !!GEMINI_API_KEY ? "operational" : "not_configured",
      },
    });
  } catch (error) {
    res.status(500).json({ status: "degraded", error: error.message });
  }
});

// ======================
// Database Connection
// ======================
async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 5000,
      maxPoolSize: 10,
    });
    console.log("MongoDB connected");

    // Initial data fetch on startup
    await fetchAndStoreNews("india news", 20);
    await fetchAndStoreNews("technology", 15);
    await fetchAndStoreNews("business", 15);
    await fetchAndStoreNews("sports", 15);
  } catch (err) {
    console.error("Database connection error:", err);
    process.exit(1);
  }
}

// Graceful shutdown
process.on("SIGINT", async () => {
  await mongoose.connection.close();
  console.log("MongoDB connection closed");
  process.exit(0);
});

// Start server
connectDB().then(() => {
  app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
  });
});

export default app;
