import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { FiSearch, FiHome, FiBookmark, FiUser } from "react-icons/fi";

const Navbar = ({ value, setSearchQuery, onSearch }) => {
  const navigate = useNavigate();
  const [isMobileSearchOpen, setIsMobileSearchOpen] = useState(false);

  const handleSearch = (e) => {
    e.preventDefault();
    if (onSearch) {
      onSearch(); // This will call the fetchNews function from NewsList
    }
  };

  return (
    <header className="bg-white shadow-sm sticky top-0 z-10 mb-10">
      <div className="container mx-auto px-4">
        <div className="flex justify-between items-center h-16">
          {/* Logo/Brand */}
          <div className="flex-shrink-0 flex items-center">
            <Link to="/" className="text-xl font-bold text-blue-600">
              NewsHub
            </Link>
          </div>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex space-x-8">
            <Link
              to="/"
              className="text-gray-700 hover:text-blue-600 px-3 py-2 rounded-md text-sm font-medium transition-colors duration-200"
            >
              Home
            </Link>
            <Link
              to="/business"
              className="text-gray-700 hover:text-blue-600 px-3 py-2 rounded-md text-sm font-medium transition-colors duration-200"
            >
              Business
            </Link>
            <Link
              to="/technology"
              className="text-gray-700 hover:text-blue-600 px-3 py-2 rounded-md text-sm font-medium transition-colors duration-200"
            >
              Technology
            </Link>
            <Link
              to="/sports"
              className="text-gray-700 hover:text-blue-600 px-3 py-2 rounded-md text-sm font-medium transition-colors duration-200"
            >
              Sports
            </Link>
          </nav>

          {/* Search and User Actions (Desktop) */}
          <div className="hidden md:flex items-center space-x-4">
            <form
              onSubmit={handleSearch}
              className="relative flex items-center"
            >
              <input
                type="text"
                value={value}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search news..."
                className="pl-10 pr-4 py-2 border border-gray-300 rounded-full text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent w-64"
              />
              <FiSearch className="absolute left-3 top-2.5 text-gray-400" />
              <button
                type="submit"
                className="ml-2 px-4 py-2 bg-blue-600 text-white rounded-full hover:bg-blue-700 transition-colors duration-200 text-sm"
              >
                Search
              </button>
            </form>
            <button className="p-2 text-gray-600 hover:text-blue-600 rounded-full hover:bg-gray-100 transition-colors duration-200">
              <FiBookmark size={18} />
            </button>
            <button className="p-2 text-gray-600 hover:text-blue-600 rounded-full hover:bg-gray-100 transition-colors duration-200">
              <FiUser size={18} />
            </button>
          </div>

          {/* Mobile menu button */}
          <div className="md:hidden flex items-center">
            <button
              onClick={() => setIsMobileSearchOpen(!isMobileSearchOpen)}
              className="p-2 text-gray-600 hover:text-blue-600 rounded-full hover:bg-gray-100 transition-colors duration-200"
            >
              <FiSearch size={20} />
            </button>
            <button className="ml-2 p-2 text-gray-600 hover:text-blue-600 rounded-full hover:bg-gray-100 transition-colors duration-200">
              <svg
                className="h-6 w-6"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 6h16M4 12h16M4 18h16"
                />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Search (Hidden by default) */}
      {isMobileSearchOpen && (
        <div className="md:hidden bg-white border-t border-gray-200 p-4">
          <form onSubmit={handleSearch} className="flex">
            <input
              type="text"
              value={value}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search news..."
              className="flex-1 px-4 py-2 border border-gray-300 rounded-l-full text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            <button
              type="submit"
              className="px-4 py-2 bg-blue-600 text-white rounded-r-full hover:bg-blue-700 transition-colors duration-200"
            >
              <FiSearch size={18} />
            </button>
          </form>
        </div>
      )}

      {/* Mobile Navigation (Hidden by default) */}
      <div className="md:hidden bg-white border-t border-gray-200">
        <div className="px-2 pt-2 pb-3 space-y-1">
          <Link
            to="/"
            className="flex items-center px-3 py-2 text-base font-medium text-gray-700 hover:text-blue-600 hover:bg-gray-50 rounded-md"
          >
            <FiHome className="mr-2" size={18} />
            Home
          </Link>
          <Link
            to="/business"
            className="flex items-center px-3 py-2 text-base font-medium text-gray-700 hover:text-blue-600 hover:bg-gray-50 rounded-md"
          >
            Business
          </Link>
          <Link
            to="/technology"
            className="flex items-center px-3 py-2 text-base font-medium text-gray-700 hover:text-blue-600 hover:bg-gray-50 rounded-md"
          >
            Technology
          </Link>
          <Link
            to="/sports"
            className="flex items-center px-3 py-2 text-base font-medium text-gray-700 hover:text-blue-600 hover:bg-gray-50 rounded-md"
          >
            Sports
          </Link>
        </div>
      </div>
    </header>
  );
};

export default Navbar;
