import express from "express";
import axios from "axios";
import cors from "cors";
import dotenv from "dotenv";
import compression from "compression";
import helmet from "helmet";

dotenv.config({ path: "../.env" });

const app = express();
const port = process.env.PORT || 3000; // Use environment port or default to 3000

// Production-specific middleware
if (process.env.NODE_ENV === "production") {
  app.use(compression());
  app.use(helmet());
}

// ======================
// Middleware Configuration
// ======================
app.use(
  cors({
    origin: process.env.CORS_ORIGIN?.split(",") || [
      "https://news-hub-app-six.vercel.app", // No trailing slash!
      "http://localhost:5173", // Keep for local development
    ],
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
console.log("NODE_ENV:", process.env.NODE_ENV);
const SERPAPI_KEY = process.env.SERPAPI_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const GEMINI_API_URL =
  process.env.GEMINI_API_URL ||
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent";
const CACHE_TTL = parseInt(process.env.CACHE_TTL) || 300000;
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES) || 3;

// ======================
// Data Store
// ======================
let newsCache = {
  articles: [],
  timestamp: null,
  query: "",
};

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
// API Endpoints
// ======================

// 1. News Fetching Endpoint
app.get("/api/google-news", async (req, res) => {
  try {
    const { query = "India news", num = 10 } = req.query;

    if (isNaN(num) || num < 1 || num > 50) {
      return res.status(400).json({
        success: false,
        error: "Number of results must be between 1 and 50",
      });
    }

    const cacheValid =
      newsCache.timestamp &&
      Date.now() - newsCache.timestamp < CACHE_TTL &&
      newsCache.query === query;

    if (cacheValid) {
      return res.json({
        success: true,
        articles: newsCache.articles,
        cached: true,
      });
    }

    const data = await fetchWithRetry("https://serpapi.com/search.json", {
      params: {
        engine: "google_news",
        q: query,
        api_key: SERPAPI_KEY,
        num: parseInt(num),
      },
    });

    const articles = (data.news_results || []).map((article) => ({
      title: article.title,
      description: article.snippet || "",
      link: article.link,
      image: article.thumbnail,
      source: article.source?.name || "",
      date: article.date,
    }));

    newsCache = {
      articles,
      timestamp: Date.now(),
      query,
    };

    res.json({
      success: true,
      articles,
    });
  } catch (error) {
    console.error("News endpoint error:", error.message);
    res.status(500).json({
      success: false,
      error: "Failed to fetch news",
      details:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// 2. Article Detail Endpoint
app.get("/api/article", async (req, res) => {
  try {
    const { url } = req.query;

    if (!url) {
      return res.status(400).json({
        success: false,
        error: "Article URL is required",
      });
    }

    const article = newsCache.articles.find((a) => a.link === url);

    if (!article) {
      return res.status(404).json({
        success: false,
        error: "Article not found. Try refreshing the news list.",
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
      error: "Internal server error",
    });
  }
});

// 3. Content Generation Endpoint for gemini-1.5-flash
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
    res.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
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
// Server Startup
// ======================
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
export default app;
