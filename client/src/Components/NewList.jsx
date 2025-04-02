import React, { useState, useEffect } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";

function NewsList({ searchQuery, searchTrigger }) {
  const [newsArticles, setNewsArticles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isSmallScreen, setIsSmallScreen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const checkScreenSize = () => {
      setIsSmallScreen(window.innerWidth < 768);
    };

    checkScreenSize();
    window.addEventListener("resize", checkScreenSize);
    return () => window.removeEventListener("resize", checkScreenSize);
  }, []);

  const extractArticleId = (url) => {
    try {
      const parsedUrl = new URL(url);
      const pathParts = parsedUrl.pathname.split("/");
      const lastPart = pathParts[pathParts.length - 1];
      return /^[a-z0-9]{8,}$/i.test(lastPart) ? lastPart : null;
    } catch {
      return null;
    }
  };

  const fetchNews = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await axios.get(
        `http://localhost:3000/api/google-news?query=${encodeURIComponent(
          searchQuery
        )}`
      );

      if (response.data.success && Array.isArray(response.data.articles)) {
        setNewsArticles(response.data.articles);
        if (response.data.articles.length === 0) {
          setError("No articles found for this search");
        }
      } else {
        throw new Error("Invalid data format received from server");
      }
    } catch (err) {
      console.error("News fetch error:", err);
      setError(err.message || "Failed to fetch news");
      setNewsArticles([]);
    } finally {
      setLoading(false);
    }
  };

  // Fetch news when searchTrigger changes
  useEffect(() => {
    if (searchQuery) {
      fetchNews();
    }
  }, [searchTrigger]);

  const handleReadArticle = (article) => {
    navigate(`/article?url=${encodeURIComponent(article.link)}`, {
      state: {
        articleData: article,
        articleUrl: article.link,
      },
    });
  };

  const ArticleCard = ({ article }) => (
    <div className="rounded-lg shadow-md overflow-hidden bg-white hover:shadow-lg transition-shadow duration-200">
      {article.image && (
        <img
          src={article.image}
          alt={article.title}
          className="w-full h-48 object-cover"
          onError={(e) => (e.target.style.display = "none")}
        />
      )}
      <div className="p-4">
        <div className="flex justify-between items-center mb-2">
          <span className="text-xs bg-gray-100 px-2 py-1 rounded-full">
            {article.source}
          </span>
          <span className="text-xs text-gray-500">{article.date}</span>
        </div>
        <h3 className="text-lg font-semibold mb-2 line-clamp-2">
          {article.title}
        </h3>
        <button
          onClick={() => handleReadArticle(article)}
          className="mt-2 w-full bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded-md transition-colors duration-200"
        >
          Read full article
        </button>
      </div>
    </div>
  );

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500 mb-4"></div>
        <p className="text-gray-600">Loading news articles...</p>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-6 font-sans">
      {error && (
        <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-4 mb-6 rounded">
          <div className="flex justify-between items-center">
            <p>{error}</p>
            <button
              onClick={fetchNews}
              className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded text-sm"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {!error && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {newsArticles.map((article, index) => (
            <ArticleCard key={`${article.link}-${index}`} article={article} />
          ))}
        </div>
      )}

      {!error && newsArticles.length === 0 && (
        <div className="text-center py-10">
          <p className="text-gray-500">
            No articles found. Try a different search term.
          </p>
        </div>
      )}
    </div>
  );
}

export default NewsList;
