import React, { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import axios from "axios";
import Navbar from "./NavBar";

function ArticlePage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [article, setArticle] = useState(location.state?.articleData || null);
  const [generatedContent, setGeneratedContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [retryCount, setRetryCount] = useState(0);

  const fetchArticleAndGenerate = async () => {
    setLoading(true);
    setError(null);

    try {
      // 1. Fetch article if not in state
      if (!article && location.state?.articleUrl) {
        const articleResponse = await axios.get(
          "https://news-hub-api.vercel.app/api/article",
          {
            params: { url: location.state.articleUrl },
          }
        );

        if (!articleResponse.data.success) {
          throw new Error(articleResponse.data.error || "Article not found");
        }
        setArticle(articleResponse.data.article);
      }

      // 2. Generate content
      const generateResponse = await axios.post(
        "https://news-hub-api.vercel.app/api/generate-story",
        {
          title: article?.title || location.state?.articleData?.title,
          source: article?.source || location.state?.articleData?.source,
          imageUrl: article?.image || location.state?.articleData?.image,
        }
      );

      if (!generateResponse.data.success) {
        throw new Error(generateResponse.data.error || "Generation failed");
      }

      setGeneratedContent(generateResponse.data.content);
    } catch (err) {
      console.error("Error:", err);

      if (retryCount < 2 && err.response?.status !== 404) {
        setTimeout(() => setRetryCount((c) => c + 1), 1000);
        return;
      }

      setError({
        message:
          err.response?.data?.error || err.message || "Failed to load article",
        isPermanent: err.response?.status === 404,
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchArticleAndGenerate();
  }, [retryCount]);

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500 mb-4"></div>
        <p className="text-gray-600">
          {retryCount > 0 ? "Retrying..." : "Loading content..."}
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4">
        <div className="max-w-md w-full bg-white p-6 rounded-lg shadow-md">
          <h2 className="text-xl font-bold text-red-600 mb-3">
            Error Loading Article
          </h2>
          <p className="text-gray-700 mb-4">{error.message}</p>
          <div className="flex flex-col sm:flex-row gap-3">
            {!error.isPermanent && (
              <button
                onClick={() => setRetryCount((c) => c + 1)}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md transition-colors duration-200"
              >
                Retry ({2 - retryCount} attempts left)
              </button>
            )}
            <button
              onClick={() => navigate("/")}
              className="bg-gray-200 hover:bg-gray-300 text-gray-800 px-4 py-2 rounded-md transition-colors duration-200"
            >
              Back to News
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
              {/* <Navbar/> */}
      <button
        onClick={() => navigate(-1)}
        className="flex items-center text-blue-600 hover:text-blue-800 mb-6 transition-colors duration-200"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className="h-5 w-5 mr-1"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z"
            clipRule="evenodd"
          />
        </svg>
        Back to news
      </button>

      <article className="bg-white rounded-lg shadow-md overflow-hidden">
        {article?.image && (
          <img
            src={article.image}
            alt={article.title}
            className="w-full h-64 md:h-96 object-cover"
          />
        )}

        <div className="p-6">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <span className="text-sm bg-gray-100 px-3 py-1 rounded-full">
              {article?.source}
            </span>
            <span className="text-sm text-gray-500">{article?.date}</span>
          </div>

          <h1 className="text-2xl md:text-3xl font-bold text-gray-800 mb-6">
            {article?.title}
          </h1>

          <div className="prose max-w-none">
            {generatedContent ? (
              generatedContent.split("\n\n").map((para, i) => (
                <p key={`para-${i}`} className="mb-4 text-gray-700">
                  {para}
                </p>
              ))
            ) : (
              <p className="text-gray-500 italic">
                No additional content available
              </p>
            )}
          </div>
        </div>
      </article>
    </div>
  );
}

export default ArticlePage;
