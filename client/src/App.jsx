import { useState } from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import "./App.css";
import NewsList from "../../api/NewList";
import ArticlePage from "./Components/ArticlesPage";
import Navbar from "./Components/NavBar";

function App() {
  const [searchQuery, setSearchQuery] = useState("India news");
  const [searchTrigger, setSearchTrigger] = useState(0); // Counter to trigger searches

  const handleSearch = () => {
    setSearchTrigger((prev) => prev + 1); // Increment to trigger effect in NewsList
  };

  return (
    <Router>
      <div className="app-container">
        <Navbar
          value={searchQuery}
          setSearchQuery={setSearchQuery}
          onSearch={handleSearch}
        />

        <main className="main-content">
          <Routes>
            <Route
              path="/"
              element={
                <NewsList
                  searchQuery={searchQuery}
                  searchTrigger={searchTrigger}
                />
              }
            />
            <Route path="/article/:id" element={<ArticlePage />} />
            <Route path="/article" element={<ArticlePage />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;
