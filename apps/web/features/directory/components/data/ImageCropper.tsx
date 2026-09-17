'use client';

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { CheckIcon, LoaderCircleIcon, RotateCcwIcon, XIcon, ZoomInIcon, ZoomOutIcon } from '@/features/shared/icons';

interface ImageCropperProps {
  imageFile: File;
  onCrop: (croppedBlob: Blob) => void;
  onCancel: () => void;
  isUploading?: boolean;
  shape?: 'square' | 'circle';
  outputWidth?: number;
  outputHeight?: number;
  /** Name shown under the card preview so the user can see how the photo will look in context */
  previewName?: string;
  /** Type color for the card preview border */
  previewColor?: string;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.1;
const DEFAULT_OUTPUT_WIDTH = 400; // 4:3 to match node card aspect ratio
const DEFAULT_OUTPUT_HEIGHT = 300;
// `outputWidth`/`outputHeight` give the SHAPE of the crop, not its resolution.
// Writing the canvas at exactly those numbers threw away everything a good
// photograph had: a 4000px picture became a 400px JPEG before it ever reached
// the server, and no amount of quality downstream brings that back. The canvas
// is sized from the pixels the crop rectangle actually covers instead, capped
// here and never upscaled past the source.
const MAX_OUTPUT_EDGE = 1440;

export default function ImageCropper({
  imageFile,
  onCrop,
  onCancel,
  isUploading = false,
  shape = 'square',
  outputWidth = DEFAULT_OUTPUT_WIDTH,
  outputHeight = DEFAULT_OUTPUT_HEIGHT,
  previewName,
  previewColor = '#6366f1',
}: ImageCropperProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });

  // Container dimensions — match output aspect ratio
  const containerWidth = 300;
  const containerHeight = shape === 'circle' ? 300 : Math.round(300 * (outputHeight / outputWidth));

  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const loadedImageRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(imageFile);
    setImageUrl(url);

    const img = new Image();
    img.onload = () => {
      setImageSize({ width: img.width, height: img.height });
      loadedImageRef.current = img;
      setPosition({ x: 0, y: 0 });
      setZoom(1);
    };
    img.src = url;

    return () => URL.revokeObjectURL(url);
  }, [imageFile]);

  // Calculate scaled dimensions
  const getScaledDimensions = useCallback(() => {
    if (imageSize.width === 0 || imageSize.height === 0) {
      return { width: containerWidth, height: containerHeight };
    }

    const imageAspect = imageSize.width / imageSize.height;
    const containerAspect = containerWidth / containerHeight;
    let baseWidth: number;
    let baseHeight: number;

    // Scale so the image covers the entire container (object-fit: cover style)
    if (imageAspect > containerAspect) {
      // Image is wider than container - fit by height
      baseHeight = containerHeight;
      baseWidth = containerHeight * imageAspect;
    } else {
      // Image is taller than container - fit by width
      baseWidth = containerWidth;
      baseHeight = containerWidth / imageAspect;
    }

    return {
      width: baseWidth * zoom,
      height: baseHeight * zoom,
    };
  }, [imageSize, containerWidth, containerHeight, zoom]);

  // Clamp position to keep image within bounds
  const clampPosition = useCallback((x: number, y: number) => {
    const scaled = getScaledDimensions();
    const maxX = Math.max(0, (scaled.width - containerWidth) / 2);
    const maxY = Math.max(0, (scaled.height - containerHeight) / 2);

    return {
      x: Math.max(-maxX, Math.min(maxX, x)),
      y: Math.max(-maxY, Math.min(maxY, y)),
    };
  }, [getScaledDimensions, containerWidth, containerHeight]);

  const handleMouseDown = (e: React.MouseEvent | React.TouchEvent) => {
    if (isUploading) return;
    e.preventDefault();
    setIsDragging(true);

    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    setDragStart({
      x: clientX - position.x,
      y: clientY - position.y,
    });
  };

  const handleMouseMove = useCallback((e: MouseEvent | TouchEvent) => {
    if (!isDragging) return;

    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    const newX = clientX - dragStart.x;
    const newY = clientY - dragStart.y;

    setPosition(clampPosition(newX, newY));
  }, [isDragging, dragStart, clampPosition]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
      window.addEventListener('touchmove', handleMouseMove);
      window.addEventListener('touchend', handleMouseUp);

      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
        window.removeEventListener('touchmove', handleMouseMove);
        window.removeEventListener('touchend', handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  // Adjust position when zoom changes
  useEffect(() => {
    setPosition(prev => clampPosition(prev.x, prev.y));
  }, [zoom, clampPosition]);

  // Zoom handlers
  const handleZoomIn = () => {
    setZoom(prev => Math.min(MAX_ZOOM, prev + ZOOM_STEP));
  };

  const handleZoomOut = () => {
    setZoom(prev => Math.max(MIN_ZOOM, prev - ZOOM_STEP));
  };

  const handleReset = () => {
    setZoom(1);
    setPosition({ x: 0, y: 0 });
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (isUploading) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
    setZoom(prev => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, prev + delta)));
  };

  // Crop the image
  const handleCrop = useCallback(() => {
    if (!imageUrl || imageSize.width === 0) return;

    const img = new Image();
    img.onload = () => {
      const scaled = getScaledDimensions();

      // Calculate the source rectangle in the original image
      const scaleX = img.width / scaled.width;
      const scaleY = img.height / scaled.height;

      // Center point in the scaled image
      const centerX = scaled.width / 2 - position.x;
      const centerY = scaled.height / 2 - position.y;

      // Crop rectangle in original image coordinates
      const cropWidth = containerWidth * scaleX;
      const cropHeight = containerHeight * scaleY;
      const sourceX = (centerX - containerWidth / 2) * scaleX;
      const sourceY = (centerY - containerHeight / 2) * scaleY;

      // The crop's own resolution, in the requested aspect ratio.
      const aspect = outputWidth / outputHeight;
      const longEdge = Math.min(
        MAX_OUTPUT_EDGE,
        Math.max(outputWidth, outputHeight, Math.round(Math.max(cropWidth, cropHeight))),
      );
      const width = aspect >= 1 ? longEdge : Math.round(longEdge * aspect);
      const height = aspect >= 1 ? Math.round(longEdge / aspect) : longEdge;

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      // For circle shape, clip canvas so output has a transparent circular mask
      if (shape === 'circle') {
        ctx.beginPath();
        ctx.arc(width / 2, height / 2, width / 2, 0, Math.PI * 2);
        ctx.clip();
      }

      // Draw the cropped region
      ctx.drawImage(img, sourceX, sourceY, cropWidth, cropHeight, 0, 0, width, height);

      // WebP either way: it carries the circle's alpha the way PNG does, at a
      // fraction of the bytes, and the upload re-encodes to WebP regardless.
      canvas.toBlob(
        (blob) => {
          if (blob) {
            onCrop(blob);
          }
        },
        'image/webp',
        0.92,
      );
    };
    img.src = imageUrl;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUrl, imageSize, position, containerWidth, containerHeight, outputWidth, outputHeight, getScaledDimensions, onCrop]);

  // Live preview: render current crop into preview canvas
  useEffect(() => {
    const canvas = previewCanvasRef.current;
    const img = loadedImageRef.current;
    if (!canvas || !img || imageSize.width === 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const scaled = getScaledDimensions();
    const scaleX = img.width / scaled.width;
    const scaleY = img.height / scaled.height;

    const centerX = scaled.width / 2 - position.x;
    const centerY = scaled.height / 2 - position.y;

    const cropWidth = containerWidth * scaleX;
    const cropHeight = containerHeight * scaleY;
    const sourceX = (centerX - containerWidth / 2) * scaleX;
    const sourceY = (centerY - containerHeight / 2) * scaleY;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (shape === 'circle') {
      ctx.save();
      ctx.beginPath();
      ctx.arc(canvas.width / 2, canvas.height / 2, canvas.width / 2, 0, Math.PI * 2);
      ctx.clip();
    }

    ctx.drawImage(img, sourceX, sourceY, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);

    if (shape === 'circle') {
      ctx.restore();
    }
  }, [position, zoom, imageSize, shape, containerWidth, containerHeight, getScaledDimensions]);

  const scaledDimensions = getScaledDimensions();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className={`bg-surface-1 rounded-2xl shadow-float w-full mx-4 overflow-hidden ${previewName ? 'max-w-2xl' : 'max-w-md'}`}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle">
          <h3 className="text-lg font-semibold text-text-primary">Adjust Photo</h3>
          <button
            type="button"
            onClick={onCancel}
            disabled={isUploading}
            className="p-2 text-text-muted hover:text-text-muted hover:bg-surface-3 rounded-lg transition-colors disabled:opacity-50"
          >
            <XIcon className="w-5 h-5" />
          </button>
        </div>

        {/* Cropper + Preview area */}
        <div className={`p-5 ${previewName ? 'flex gap-6' : ''}`}>
          {/* Cropper side */}
          <div className={previewName ? 'flex-1 min-w-0' : ''}>
            <p className="text-sm text-text-muted mb-4 text-center">
              Drag to reposition. Scroll or use buttons to zoom.
            </p>

            {/* Crop container */}
            <div className="flex justify-center mb-4">
              <div
                ref={containerRef}
                className={`relative overflow-hidden bg-gray-900 cursor-move ring-2 ring-white/30 ${shape === 'circle' ? 'rounded-full' : 'rounded-2xl'}`}
                style={{ width: containerWidth, height: containerHeight }}
                onMouseDown={handleMouseDown}
                onTouchStart={handleMouseDown}
                onWheel={handleWheel}
              >
                {imageUrl && (
                  <img
                    ref={imageRef}
                    src={imageUrl}
                    alt="Crop preview"
                    className="absolute select-none pointer-events-none"
                    style={{
                      width: scaledDimensions.width,
                      height: scaledDimensions.height,
                      left: '50%',
                      top: '50%',
                      transform: `translate(-50%, -50%) translate(${position.x}px, ${position.y}px)`,
                      maxWidth: 'none',
                    }}
                    draggable={false}
                  />
                )}
              </div>
            </div>

            {/* Zoom controls */}
            <div className="flex items-center justify-center gap-4 mb-4">
              <button
                type="button"
                onClick={handleZoomOut}
                disabled={zoom <= MIN_ZOOM || isUploading}
                className="p-2 text-text-muted hover:text-text-primary hover:bg-surface-3 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ZoomOutIcon className="w-5 h-5" />
              </button>

              <div className="flex-1 max-w-[150px]">
                <input
                  type="range"
                  min={MIN_ZOOM}
                  max={MAX_ZOOM}
                  step={ZOOM_STEP}
                  value={zoom}
                  onChange={(e) => setZoom(parseFloat(e.target.value))}
                  disabled={isUploading}
                  className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600 disabled:opacity-50"
                />
              </div>

              <button
                type="button"
                onClick={handleZoomIn}
                disabled={zoom >= MAX_ZOOM || isUploading}
                className="p-2 text-text-muted hover:text-text-primary hover:bg-surface-3 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ZoomInIcon className="w-5 h-5" />
              </button>

              <button
                type="button"
                onClick={handleReset}
                disabled={isUploading}
                className="p-2 text-text-muted hover:text-text-primary hover:bg-surface-3 rounded-lg transition-colors disabled:opacity-50"
                title="Reset"
              >
                <RotateCcwIcon className="w-5 h-5" />
              </button>
            </div>

            {/* Zoom percentage */}
            <div className="text-center text-sm text-text-muted mb-4">
              {Math.round(zoom * 100)}%
            </div>
          </div>

          {/* Live card preview */}
          {previewName && (
            <div className="flex flex-col items-center justify-center w-[180px] shrink-0">
              <p className="text-xs font-medium text-text-muted uppercase tracking-wide mb-3">Preview</p>
              <div
                className="rounded-xl overflow-hidden w-[160px] bg-surface-1"
                style={{
                  border: `3px solid ${previewColor}`,
                  boxShadow: `0 0 10px 1px ${previewColor}44`,
                }}
              >
                <canvas
                  ref={previewCanvasRef}
                  width={outputWidth}
                  height={outputHeight}
                  className="w-full"
                  style={{ aspectRatio: `${outputWidth} / ${outputHeight}`, display: 'block' }}
                />
                <div className="px-3 py-2.5 text-center">
                  <p className="text-xs font-semibold text-text-primary truncate">{previewName}</p>
                </div>
              </div>
              <p className="text-[10px] text-text-muted mt-2 text-center">How it appears on cards</p>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-3 px-5 py-4 bg-surface-2 border-t border-border-subtle">
          <button
            type="button"
            onClick={onCancel}
            disabled={isUploading}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-text-secondary bg-surface-1 border border-border-default rounded-lg hover:bg-surface-2 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleCrop}
            disabled={isUploading}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:bg-blue-400"
          >
            {isUploading ? (
              <>
                <LoaderCircleIcon className="w-4 h-4 animate-spin" />
                Uploading...
              </>
            ) : (
              <>
                <CheckIcon className="w-4 h-4" />
                Save Photo
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
