import React, { useState, useCallback, useRef } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

function cn(...inputs: (string | false | null | undefined)[]) {
  return twMerge(clsx(inputs));
}

// Use the bundled PDF.js worker via CDN to avoid worker bundling complexity.
pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

interface PdfViewerProps {
  tab: { path: string; name: string };
  showToast?: (message: string, type: 'error' | 'warning' | 'success' | 'info') => void;
}

const PdfViewer = ({ tab, showToast }: PdfViewerProps) => {
  const [numPages, setNumPages] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(1.2);
  const containerRef = useRef<HTMLDivElement>(null);

  const onDocumentLoadSuccess = useCallback(({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    setCurrentPage(1);
  }, []);

  const onDocumentLoadError = useCallback((err: Error) => {
    showToast?.(`Failed to load PDF: ${err.message}`, 'error');
  }, [showToast]);

  const zoomIn = () => setScale(s => Math.min(3, s + 0.2));
  const zoomOut = () => setScale(s => Math.max(0.4, s - 0.2));

  return (
    <div className="flex flex-col h-full overflow-hidden bg-bg-surface">
      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 h-10 border-b border-border bg-bg-elevated shrink-0">
        <button
          onClick={zoomOut}
          className="px-2 py-1 text-xs text-text-secondary hover:text-text-primary hover:bg-bg-overlay rounded transition-colors"
          title="Zoom out"
        >
          −
        </button>
        <span className="text-xs text-text-tertiary w-12 text-center">{Math.round(scale * 100)}%</span>
        <button
          onClick={zoomIn}
          className="px-2 py-1 text-xs text-text-secondary hover:text-text-primary hover:bg-bg-overlay rounded transition-colors"
          title="Zoom in"
        >
          +
        </button>
        {numPages && (
          <>
            <div className="h-4 w-px bg-border mx-1" />
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage <= 1}
              className="px-2 py-1 text-xs text-text-secondary hover:text-text-primary hover:bg-bg-overlay rounded transition-colors disabled:opacity-30"
            >
              ‹
            </button>
            <span className="text-xs text-text-tertiary">
              {currentPage} / {numPages}
            </span>
            <button
              onClick={() => setCurrentPage(p => Math.min(numPages, p + 1))}
              disabled={currentPage >= numPages}
              className="px-2 py-1 text-xs text-text-secondary hover:text-text-primary hover:bg-bg-overlay rounded transition-colors disabled:opacity-30"
            >
              ›
            </button>
          </>
        )}
      </div>

      {/* PDF content */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto flex justify-center py-6 bg-bg-base"
      >
        <Document
          file={`file://${tab.path}`}
          onLoadSuccess={onDocumentLoadSuccess}
          onLoadError={onDocumentLoadError}
          loading={
            <div className="flex items-center justify-center h-64 text-text-tertiary text-sm">
              Loading PDF…
            </div>
          }
          error={
            <div className="flex items-center justify-center h-64 text-error text-sm">
              Failed to load PDF
            </div>
          }
        >
          <Page
            pageNumber={currentPage}
            scale={scale}
            className={cn('shadow-lg rounded-sm')}
            renderTextLayer
            renderAnnotationLayer
          />
        </Document>
      </div>
    </div>
  );
};

export default PdfViewer;
