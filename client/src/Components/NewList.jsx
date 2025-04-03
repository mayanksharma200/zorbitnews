import React, { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";

function NewsList({ searchQuery, searchTrigger }) {
  const [newsArticles, setNewsArticles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState("");
  const [nextUpdate, setNextUpdate] = useState("");
  const [currentQuery, setCurrentQuery] = useState("");
  const navigate = useNavigate();

  // Default query for initial load
  const DEFAULT_QUERY = "india news";

  // Fetch news from database only
  const fetchNewsFromDB = useCallback(async (query) => {
    if (!query) return; // Don't fetch if no query

    setLoading(true);
    setError(null);
    try {
      const response = await axios.get(
        `https://news-hub-api.vercel.app/api/news?query=${encodeURIComponent(
          query
        )}`
      );

      if (response.data.success) {
        setNewsArticles(response.data.articles);
        setLastUpdated(new Date(response.data.lastUpdated).toLocaleString());
        setNextUpdate(new Date(response.data.nextUpdate).toLocaleString());
        setCurrentQuery(query);
      } else {
        throw new Error(response.data.error || "No articles found in database");
      }
    } catch (err) {
      console.error("Database fetch error:", err);
      setError(err.message || "Failed to fetch news from database");
      setNewsArticles([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load - fetch default data
  useEffect(() => {
    const queryToUse =  DEFAULT_QUERY;
    fetchNewsFromDB(queryToUse);
  }, [fetchNewsFromDB]);

  // Handle search triggers
  // useEffect(() => {
  //   if (searchTrigger && searchQuery) {
  //     fetchNewsFromDB(searchQuery);
  //   }
  // }, [searchTrigger, searchQuery, fetchNewsFromDB]);

  const handleReadArticle = (article) => {
    navigate(`/article?url=${encodeURIComponent(article.link)}`, {
      state: {
        articleData: article,
        articleUrl: article.link,
      },
    });
  };

  const ArticleCard = ({ article }) => (
    <div className="rounded-lg shadow-md overflow-hidden bg-white hover:shadow-lg transition-shadow duration-200 h-full flex flex-col">
      {article.image && (
        <img
          src={article.image}
          alt={article.title}
          className="w-full h-48 object-cover"
          onError={(e) => (e.target.style.display = "none")}
        />
      )}
      <div className="p-4 flex flex-col flex-grow">
        <div className="flex justify-between items-center mb-2">
          <span className="text-xs bg-gray-100 px-2 py-1 rounded-full">
            {article.source}
          </span>
          <span className="text-xs text-gray-500">
            {new Date(article.date).toLocaleDateString()}
          </span>
        </div>
        <h3 className="text-lg font-semibold mb-2 line-clamp-2">
          {article.title}
        </h3>
        {article.description && (
          <p className="text-gray-600 text-sm mb-4 line-clamp-3">
            {article.description}
          </p>
        )}
        <button
          onClick={() => handleReadArticle(article)}
          className="mt-auto w-full bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded-md transition-colors duration-200"
        >
          Read full article
        </button>
      </div>
    </div>
  );

  if (loading && newsArticles.length === 0) {
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
            {error.includes("No articles found") && (
              <p className="text-sm mb-2">Next update: {nextUpdate}</p>
            )}
            <button
              onClick={() =>
                fetchNewsFromDB(DEFAULT_QUERY)
              }
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
      {/* Data freshness information */}
      {newsArticles.length > 0 && (
        <div className="mb-4 flex justify-between items-center">
          <div className="text-sm text-gray-600">
            Showing {newsArticles.length} results for "{currentQuery}"
            <div className="text-xs mt-1">
              Last updated: {lastUpdated} | Next update: {nextUpdate}
            </div>
          </div>
          <button
            // onClick={() => fetchNewsFromDB(currentQuery)}
            className="text-sm bg-gray-200 hover:bg-gray-300 px-3 py-1 rounded"
            title="Refresh from database"
          >
            Refresh
          </button>
        </div>
      )}

      {/* Articles grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {newsArticles.map((article, index) => (
          <ArticleCard key={`${article.link}-${index}`} article={article} />
        ))}
      </div>

      {/* Empty state */}
      {!loading && newsArticles.length === 0 && (
        <div className="text-center py-10">
          <p className="text-gray-500 mb-2">
            No articles found in database for this search.
          </p>
          <p className="text-sm text-gray-400 mb-4">
            Next scheduled update: {nextUpdate}
          </p>
          <button
            // onClick={() =>
            //   fetchNewsFromDB(DEFAULT_QUERY)
            // }
            className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded"
          >
            Check Database Again
          </button>
        </div>
      )}
    </div>
  );
}

export default NewsList;
