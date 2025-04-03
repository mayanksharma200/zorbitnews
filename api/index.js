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
// newsSchema.index({ query: 1, fetchedAt: -1 });
newsSchema.index({ link: 1 }, { unique: true });
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
        { query: "India news", count: 20 },
        { query: "Technology", count: 15 },
        { query: "Business", count: 15 },
        { query: "Sports", count: 15 },
      ];

      for (const { query, count } of updateCategories) {
        console.log(`Fetching ${query} articles...`);
        // FIX: Use NewsUpdater.fetchFromSerpAPI instead of this.fetchFromSerpAPI
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

// Manual Update Trigger (for testing)
app.post("/api/admin/update-now", async (req, res) => {
  if (process.env.NODE_ENV !== "development") {
    return res.status(403).json({
      success: false,
      error: "Manual updates only allowed in development",
    });
  }

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
cron.schedule("*/1 * * * *", NewsUpdater.updateDatabase);
    console.log("Scheduled news updates every 1 minutes");

    // Initial update (delayed to let server start)
    setTimeout(() => NewsUpdater.updateDatabase(), 15000);

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