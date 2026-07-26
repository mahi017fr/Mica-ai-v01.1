import type { VercelRequest, VercelResponse } from "@vercel/node";
import { v2 as cloudinary } from "cloudinary";
import formidable from "formidable";
import type { IncomingMessage } from "http";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

function parseMultipartForm(
  req: IncomingMessage
): Promise<{ file: formidable.File; fields: formidable.Fields }> {
  return new Promise((resolve, reject) => {
    const form = formidable({
      multiples: false,
      maxFileSize: 25 * 1024 * 1024,
    });

    form.parse(req, (err, fields, files) => {
      if (err) return reject(err);

      const fileField = files.file;
      const file = Array.isArray(fileField) ? fileField[0] : fileField;

      if (!file) {
        return reject(new Error("No file uploaded"));
      }

      resolve({ file, fields });
    });
  });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { file } = await parseMultipartForm(req);

    const result = await cloudinary.uploader.upload(file.filepath, {
      resource_type: "auto",
      folder: "sendxx_uploads",
    });

    return res.status(200).json({
      success: true,
      url: result.secure_url,
    });
  } catch (err: any) {
    console.error("Cloudinary upload failed:", err);
    return res.status(500).json({
      success: false,
      error: "Upload failed: " + (err.message || "Unknown error"),
    });
  }
}
