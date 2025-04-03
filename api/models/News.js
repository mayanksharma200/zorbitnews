import mongoose from "mongoose";

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
        validator: function (v) {
          return /^(https?:\/\/).+/.test(v);
        },
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

// Indexes for better query performance
newsSchema.index({ query: 1, fetchedAt: -1 }); // For getting latest news by query
newsSchema.index({ link: 1 }, { unique: true }); // For preventing duplicates

const News = mongoose.model("News", newsSchema);

export default News;
