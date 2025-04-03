import React, { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";

function NewsList({ searchQuery, searchTrigger }) {
  const [newsData, setNewsData] = useState({
    articles: [],
    lastUpdated: "",
    nextUpdate: "",
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentQuery, setCurrentQuery] = useState("India news");
  const navigate = useNavigate();

  const fetchNewsFromDB = useCallback(async (query = "India news") => {
    setLoading(true);
    setError(null);
    try {
      const response = await axios.get(
        `https://news-hub-api.vercel.app/api/news?query=${encodeURIComponent(
          query
        )}`
      );

      if (!response.data?.success) {
        throw new Error(response.data?.error || "Invalid response from server");
      }

      setNewsData({
        articles: Array.isArray(response.data.data) ? response.data.data : [],
        lastUpdated: response.data.meta?.lastUpdated || "Unknown",
        nextUpdate: response.data.meta?.nextUpdate || "Unknown",
      });
      setCurrentQuery(query);
    } catch (err) {
      console.error("Fetch error:", err);
      setError(err.message || "Failed to fetch news");
      setNewsData((prev) => ({ ...prev, articles: [] }));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNewsFromDB();
  }, [fetchNewsFromDB]);

  const handleReadArticle = (article) => {
    if (!article?.link) return;
    navigate(`/article?url=${encodeURIComponent(article.link)}`, {
      state: { articleData: article },
    });
  };

  const ArticleCard = ({ article }) => {
    if (!article) return null;

    return (
      <div className="rounded-lg shadow-md overflow-hidden bg-white hover:shadow-lg transition-shadow duration-200 h-full flex flex-col">
        {article.image && (
          <img
            src={article.image}
            alt={article.title || "News image"}
            className="w-full h-48 object-cover"
            onError={(e) => (e.target.style.display = "none")}
          />
        )}
        <div className="p-4 flex flex-col flex-grow">
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs bg-gray-100 px-2 py-1 rounded-full">
              {article.source || "Unknown"}
            </span>
            <span className="text-xs text-gray-500">
              {article.date
                ? new Date(article.date).toLocaleDateString()
                : "N/A"}
            </span>
          </div>
          <h3 className="text-lg font-semibold mb-2 line-clamp-2">
            {article.title || "No title available"}
          </h3>
          {article.description && (
            <p className="text-gray-600 text-sm mb-4 line-clamp-3">
              {article.description}
            </p>
          )}
          <button
            onClick={() => handleReadArticle(article)}
            className="mt-auto w-full bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded-md transition-colors duration-200"
            disabled={!article.link}
          >
            Read full article
          </button>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500 mb-4"></div>
        <p className="text-gray-600">Loading news articles...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4">
        <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-4 mb-6 rounded max-w-md w-full">
          <div className="flex flex-col items-center">
            <p className="mb-4 text-center">{error}</p>
            <button
              onClick={() => fetchNewsFromDB(currentQuery)}
              className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded"
            >
              Try Again
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-6 font-sans">
      <div className="mb-4 flex justify-between items-center">
        <div className="text-sm text-gray-600">
          Showing {newsData.articles.length} results for "{currentQuery}"
          <div className="text-xs mt-1">
            Last updated: {newsData.lastUpdated} | Next update:{" "}
            {newsData.nextUpdate}
          </div>
        </div>
        <button
          onClick={() => fetchNewsFromDB(currentQuery)}
          className="text-sm bg-gray-200 hover:bg-gray-300 px-3 py-1 rounded"
        >
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {newsData.articles.map((article) => (
          <ArticleCard key={article._id} article={article} />
        ))}
      </div>

      {newsData.articles.length === 0 && !loading && (
        <div className="text-center py-10">
          <p className="text-gray-500 mb-2">
            No articles found for this query.
          </p>
          <button
            onClick={() => fetchNewsFromDB("India news")}
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded"
          >
            Load Default News
          </button>
        </div>
      )}
    </div>
  );
}

export default NewsList;
