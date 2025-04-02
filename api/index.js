import express from "express";
import axios from "axios";
import cors from "cors";
import dotenv from "dotenv";
import compression from "compression";
import helmet from "helmet";

dotenv.config({ path: "../.env.development" });

const app = express();
const port = 3000;

if (process.env.NODE_ENV === "production") {
  app.use(compression());
  app.use(helmet());
}

app.use(
  cors({
    origin: process.env.CORS_ORIGIN || [
      "http://localhost:5173",
      "https://your-vercel-app.vercel.app",
    ],
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
    credentials: true,
  })
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

console.log("NODE_ENV:", process.env.NODE_ENV);
const SERPAPI_KEY = process.env.SERPAPI_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
console.log("SERPAPI_KEY:", SERPAPI_KEY);
console.log("GEMINI_API_KEY:", GEMINI_API_KEY);

const GEMINI_API_URL =
  process.env.GEMINI_API_URL ||
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent";
const CACHE_TTL = parseInt(process.env.CACHE_TTL || "300000", 10);
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || "3", 10);

let newsCache = { articles: [], timestamp: null, query: "" };

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

app.get("/api/google-news", async (req, res) => {
  try {
    const { query = "India news", num = 10 } = req.query;

    if (isNaN(num) || num < 1 || num > 50) {
      return res
        .status(400)
        .json({
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

    newsCache = { articles, timestamp: Date.now(), query };

    res.json({ success: true, articles });
  } catch (error) {
    console.error("News endpoint error:", error.message);
    res.status(500).json({ success: false, error: "Failed to fetch news" });
  }
});

// Example route
app.get('/api/test', (req, res) => {
  res.json({ message: "API is working!" });
});

app.post("/api/generate-story", async (req, res) => {
  try {
    const { title, source, imageUrl } = req.body;
    if (!title || !source) {
      return res
        .status(400)
        .json({
          success: false,
          error: "Title and source are required fields",
        });
    }
    if (!GEMINI_API_KEY) {
      return res
        .status(501)
        .json({
          success: false,
          error: "Content generation service not configured",
        });
    }

    const prompt = `HEADLINE: ${title}\nSOURCE: ${source}${
      imageUrl ? `\nIMAGE: ${imageUrl}` : ""
    }`;
    const response = await fetchWithRetry(
      `${GEMINI_API_URL}?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        data: {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 2048 },
        },
      }
    );

    const content = validateGeminiResponse(response).trim();
    res.json({ success: true, content });
  } catch (error) {
    console.error("Generation error:", error.message);
    res
      .status(500)
      .json({ success: false, error: "Failed to generate content" });
  }
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});

export default app;
