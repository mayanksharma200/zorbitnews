import express from "express";
import axios from "axios";
import cors from "cors";
import dotenv from "dotenv";
import compression from "compression";
import helmet from "helmet";

dotenv.config({ path: `.env.${process.env.NODE_ENV || "development"}` });



// import dotenv from "dotenv";

// Load environment variables from .env file

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
    origin: process.env.CORS_ORIGIN || "http://localhost:5174",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
    credentials: true,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ======================
// API Configuration - Now using environment variables
// ======================
const SERPAPI_KEY = process.env.SERPAPI_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_URL =
  process.env.GEMINI_API_URL ||
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent";
const CACHE_TTL = process.env.CACHE_TTL
  ? parseInt(process.env.CACHE_TTL)
  : 300000;
const MAX_RETRIES = process.env.MAX_RETRIES
  ? parseInt(process.env.MAX_RETRIES)
  : 3;

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

// 1. News Fetching Endpoint (unchanged)
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

    if (newsCache.articles.length > 0) {
      return res.json({
        success: true,
        articles: newsCache.articles,
        cached: true,
        warning: "Showing cached data due to API error",
      });
    }

    res.status(500).json({
      success: false,
      error: "Failed to fetch news",
      details:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

// 2. Article Detail Endpoint (unchanged)
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

// 3. Updated Content Generation Endpoint for gemini-1.5-flash
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

    // Enhanced prompt for gemini-1.5-flash
    const prompt = `As a senior journalist, write a comprehensive news article with these details:
    
    HEADLINE: ${title}
    SOURCE: ${source}
    ${
      imageUrl
        ? `IMAGE CONTEXT: [Consider this image in your reporting: ${imageUrl}]`
        : ""
    }

    ARTICLE REQUIREMENTS:
    - 9-10 paragraphs (800-1000 words)
    - Professional journalistic tone
    - Include relevant background context
    - Structure with: lead paragraph, key facts, expert quotes (simulated), analysis
    - End with a concluding thought
    - Strictly factual with no opinion or promotion`;

    // Enhanced API request with generation config
    const response = await fetchWithRetry(
      `${GEMINI_API_URL}?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        data: {
          contents: [
            {
              parts: [{ text: prompt }],
            },
          ],
          generationConfig: {
            temperature: 0.7,
            topP: 0.9,
            topK: 40,
            maxOutputTokens: 2048,
            stopSequences: ["\n\nEND"],
          },
          safetySettings: [
            {
              category: "HARM_CATEGORY_DANGEROUS_CONTENT",
              threshold: "BLOCK_ONLY_HIGH",
            },
            {
              category: "HARM_CATEGORY_HATE_SPEECH",
              threshold: "BLOCK_ONLY_HIGH",
            },
            {
              category: "HARM_CATEGORY_HARASSMENT",
              threshold: "BLOCK_ONLY_HIGH",
            },
            {
              category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
              threshold: "BLOCK_ONLY_HIGH",
            },
          ],
        },
      }
    );

    const content = validateGeminiResponse(response)
      .replace(/^\*+/gm, "")
      .replace(/\*\*Click here.*$/i, "")
      .trim();

    res.json({
      success: true,
      content: content || "No content was generated for this article.",
    });
  } catch (error) {
    console.error("Generation error:", {
      message: error.message,
      status: error.response?.status,
      data: error.response?.data,
    });

    let errorMessage = "Failed to generate content";
    let statusCode = 500;

    if (error.response?.status === 404) {
      errorMessage = "The AI model is currently unavailable";
      statusCode = 404;
    } else if (error.response?.status === 429) {
      errorMessage = "API rate limit exceeded";
      statusCode = 429;
    } else if (error.code === "ECONNABORTED") {
      errorMessage = "Request to AI service timed out";
    }

    // Fallback to original description if available
    const fallbackContent = req.body.description || "No content available";

    res.status(statusCode).json({
      success: false,
      error: errorMessage,
      fallbackContent: statusCode !== 404 ? fallbackContent : undefined,
      details:
        process.env.NODE_ENV === "development"
          ? error.response?.data?.error?.message || error.message
          : undefined,
    });
  }
});

// 4. Health Check Endpoint with model verification
app.get("/api/health", async (req, res) => {
  try {
    // Verify Gemini API connectivity
    const geminiStatus = GEMINI_API_KEY
      ? await axios
          .get(
            `https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_API_KEY}`,
            { timeout: 5000 }
          )
          .then(() => "operational")
          .catch(() => "unavailable")
      : "not_configured";

    res.json({
      status: "healthy",
      timestamp: new Date().toISOString(),
      cache: {
        articles: newsCache.articles.length,
        lastUpdated: newsCache.timestamp
          ? new Date(newsCache.timestamp).toISOString()
          : null,
      },
      services: {
        serpapi: !!SERPAPI_KEY ? "operational" : "not_configured",
        gemini: geminiStatus,
        currentModel: "gemini-1.5-flash",
      },
    });
  } catch (error) {
    res.status(500).json({
      status: "degraded",
      error: "Health check failed",
      details: error.message,
    });
  }
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send("Something broke!");
});

// ======================
// Server Startup
// ======================
// app.listen(port, () => {
//   console.log(`Server running on http://localhost:${port}`);
//   console.log("Available endpoints:");
//   console.log("GET  /api/google-news - Fetch news articles");
//   console.log("GET  /api/article - Get article details");
//   console.log("POST /api/generate-story - Generate article content");
//   console.log("GET  /api/health - Server health check");
// });
export default app;
