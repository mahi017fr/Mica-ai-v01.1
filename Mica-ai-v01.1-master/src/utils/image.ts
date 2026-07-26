/**
 * Utility function to compress and resize an image client-side to a tiny Base64 Data URL.
 * Storing this directly in Firestore avoids server file-system dependency issues
 * and guarantees 100% persistence in ephemeral environments like Cloud Run.
 */
export function compressImage(
  file: File,
  maxWidth = 200,
  maxHeight = 200,
  quality = 0.8
): Promise<string> {
  return new Promise((resolve, reject) => {
    // Basic file type verification
    if (!file.type.startsWith("image/")) {
      reject(new Error("File is not a valid image"));
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          let width = img.width;
          let height = img.height;

          // Standard aspect ratio resize logic
          if (width > height) {
            if (width > maxWidth) {
              height = Math.round(height * (maxWidth / width));
              width = maxWidth;
            }
          } else {
            if (height > maxHeight) {
              width = Math.round(width * (maxHeight / height));
              height = maxHeight;
            }
          }

          canvas.width = width;
          canvas.height = height;

          const ctx = canvas.getContext("2d");
          if (!ctx) {
            reject(new Error("Failed to get canvas 2D context"));
            return;
          }

          // Draw and compress image
          ctx.drawImage(img, 0, 0, width, height);
          const compressedDataUrl = canvas.toDataURL("image/jpeg", quality);
          resolve(compressedDataUrl);
        } catch (error) {
          reject(error);
        }
      };
      
      img.onerror = () => {
        reject(new Error("Failed to load image element for compression"));
      };

      if (event.target?.result) {
        img.src = event.target.result as string;
      } else {
        reject(new Error("FileReader result is empty"));
      }
    };

    reader.onerror = () => {
      reject(new Error("FileReader encountered an error reading the file"));
    };

    reader.readAsDataURL(file);
  });
}
