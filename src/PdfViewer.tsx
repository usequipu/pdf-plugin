import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { MagnifyingGlassPlusIcon, MagnifyingGlassMinusIcon, ChatTextIcon, XIcon } from '@phosphor-icons/react';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';
import type { FileSystemService, ViewerProps } from './plugin-types';

pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

type PdfAnnotationType = 'comment' | 'review' | 'todo' | 'bug' | 'question' | 'instruction';

interface PdfComment {
  id: string; page: number; selectedText?: string; topRatio?: number;
  text: string; type: PdfAnnotationType; author?: string; timestamp?: string;
}
interface SelectedTextInfo { text: string; topRatio: number; relativeTop: number; page: number; }
interface PageDimension { width: number; height: number; }
interface HighlightRect { top: number; left: number; width: number; height: number; }
interface HighlightData { rects: HighlightRect[]; pageNum: number; }
interface FrameAnnotation {
  id: string; page?: number; selectedText?: string; topRatio?: number;
  text: string; type: string; author: string; timestamp: string;
}
interface Frame {
  version: number; type: string; id: string; filePath: string;
  createdAt: string; updatedAt: string; annotations: FrameAnnotation[];
  instructions: string; history: unknown[];
}

function makeFrameService(apiFs: FileSystemService) {
  function getFramePath(wp: string, fp: string) {
    const rel = fp.startsWith(wp + '/') ? fp.slice(wp.length + 1) : fp;
    return `${wp}/.quipu/meta/${rel}.frame.json`;
  }
  function emptyFrame(wp: string, fp: string): Frame {
    const rel = fp.startsWith(wp + '/') ? fp.slice(wp.length + 1) : fp;
    return { version: 1, type: 'frame', id: crypto.randomUUID(), filePath: rel,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      annotations: [], instructions: '', history: [] };
  }
  async function readFrame(wp: string, fp: string): Promise<Frame | null> {
    try { const c = await apiFs.readFile(getFramePath(wp, fp)); return c ? JSON.parse(c) : null; }
    catch { return null; }
  }
  async function writeFrame(wp: string, fp: string, frame: Frame) {
    const p = getFramePath(wp, fp);
    try { await apiFs.createFolder(p.substring(0, p.lastIndexOf('/'))); } catch { /* exists */ }
    frame.updatedAt = new Date().toISOString();
    await apiFs.writeFile(p, JSON.stringify(frame, null, 2));
  }
  async function addAnnotation(wp: string, fp: string, ann: Omit<FrameAnnotation, 'timestamp'>) {
    let f = await readFrame(wp, fp); if (!f) f = emptyFrame(wp, fp);
    f.annotations.push({ ...ann, timestamp: new Date().toISOString() });
    await writeFrame(wp, fp, f);
  }
  async function updateAnnotationType(wp: string, fp: string, id: string, type: string) {
    const f = await readFrame(wp, fp); if (!f) return;
    const a = f.annotations.find((x) => x.id === id); if (a) { a.type = type; await writeFrame(wp, fp, f); }
  }
  async function removeAnnotation(wp: string, fp: string, id: string) {
    const f = await readFrame(wp, fp); if (!f) return;
    f.annotations = f.annotations.filter((a) => a.id !== id); await writeFrame(wp, fp, f);
  }
  return { readFrame, addAnnotation, updateAnnotationType, removeAnnotation };
}

const ANNOTATION_TYPES: PdfAnnotationType[] = ['comment', 'review', 'todo', 'bug', 'question', 'instruction'];
const TYPE_COLORS: Record<PdfAnnotationType, string> = {
  comment: 'bg-text-tertiary/20 text-text-secondary', review: 'bg-accent/20 text-accent',
  todo: 'bg-info/20 text-info', bug: 'bg-error/20 text-error',
  question: 'bg-warning/20 text-warning', instruction: 'bg-success/20 text-success',
};
const PAGE_BUFFER = 5;
const ESTIMATED_PAGE_HEIGHT = 1056;
const PAGE_GAP = 24;
const pdfOptions = {
  cMapUrl: `https://unpkg.com/pdfjs-dist@${pdfjs.version}/cmaps/`,
  cMapPacked: true,
  standardFontDataUrl: `https://unpkg.com/pdfjs-dist@${pdfjs.version}/standard_fonts/`,
};

export interface PdfViewerProps extends ViewerProps { fileSystem: FileSystemService; }

const PdfViewer = ({ tab, workspacePath, fileSystem }: PdfViewerProps) => {
  const filePath = tab.path;
  const frameService = useMemo(() => makeFrameService(fileSystem), [fileSystem]);

  const [numPages, setNumPages] = useState<number | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoomPercent, setZoomPercent] = useState(100);
  const [containerWidth, setContainerWidth] = useState(0);
  const [pageInput, setPageInput] = useState('1');
  const [visiblePages, setVisiblePages] = useState<Set<number>>(new Set([1]));
  const [pageDimensions, setPageDimensions] = useState<Record<number, PageDimension>>({});
  const [comments, setComments] = useState<PdfComment[]>([]);
  const [showCommentInput, setShowCommentInput] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [commentInputTop, setCommentInputTop] = useState(0);
  const [selectedTextInfo, setSelectedTextInfo] = useState<SelectedTextInfo | null>(null);
  const [commentType, setCommentType] = useState<PdfAnnotationType>('comment');
  const [showCommentButton, setShowCommentButton] = useState(false);
  const [commentButtonPos, setCommentButtonPos] = useState({ top: 0, left: 0 });
  const [adjustedPositions, setAdjustedPositions] = useState<Record<string, number>>({});
  const [highlightRects, setHighlightRects] = useState<Record<string, HighlightData>>({});

  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const pageRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const commentsRef = useRef<Record<string, HTMLDivElement | null>>({});
  const fileUrl = useMemo(() => fileSystem.getFileUrl(filePath), [fileSystem, filePath]);

  useEffect(() => {
    const el = scrollContainerRef.current; if (!el) return;
    const measure = () => setContainerWidth(el.clientWidth); measure();
    const ro = new ResizeObserver(measure); ro.observe(el); return () => ro.disconnect();
  }, []);

  const pageWidth = useMemo(() => {
    if (!containerWidth) return 612;
    const sidebar = containerWidth > 900 ? 340 : 0;
    return Math.max(300, ((containerWidth - 48 - sidebar) * zoomPercent) / 100);
  }, [containerWidth, zoomPercent]);

  const renderedPages = useMemo<Set<number>>(() => {
    const s = new Set<number>();
    for (const p of visiblePages)
      for (let i = Math.max(1, p - PAGE_BUFFER); i <= Math.min(numPages || 1, p + PAGE_BUFFER); i++) s.add(i);
    return s;
  }, [visiblePages, numPages]);

  const visibleComments = useMemo(() => comments.filter((c) => visiblePages.has(c.page)), [comments, visiblePages]);

  const loadComments = useCallback(async () => {
    if (!workspacePath || !filePath) return;
    try {
      const frame = await frameService.readFrame(workspacePath, filePath);
      setComments(frame?.annotations?.filter((a) => a.page != null).map((a): PdfComment => ({
        id: a.id, page: a.page!, selectedText: a.selectedText, topRatio: a.topRatio,
        text: a.text, type: (a.type as PdfAnnotationType) || 'comment',
        author: a.author, timestamp: a.timestamp,
      })) ?? []);
    } catch { setComments([]); }
  }, [workspacePath, filePath, frameService]);

  useEffect(() => { loadComments(); }, [loadComments]);

  useEffect(() => {
    if (!numPages || !scrollContainerRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => setVisiblePages((prev) => {
        const next = new Set(prev);
        for (const e of entries) {
          const n = parseInt((e.target as HTMLElement).dataset.pageNumber || '0', 10);
          if (e.isIntersecting) next.add(n); else next.delete(n);
        }
        return next;
      }),
      { root: scrollContainerRef.current, rootMargin: '200px 0px', threshold: 0.01 },
    );
    for (let i = 1; i <= numPages; i++) { const el = pageRefs.current[i]; if (el) observer.observe(el); }
    return () => observer.disconnect();
  }, [numPages]);

  useEffect(() => {
    const container = scrollContainerRef.current; if (!container || !numPages) return;
    const onScroll = () => {
      const mid = container.getBoundingClientRect().top + container.getBoundingClientRect().height / 2;
      let closest = 1, dist = Infinity;
      for (let i = 1; i <= numPages; i++) {
        const el = pageRefs.current[i]; if (!el) continue;
        const r = el.getBoundingClientRect(), d = Math.abs(r.top + r.height / 2 - mid);
        if (d < dist) { dist = d; closest = i; }
      }
      setCurrentPage(closest); setPageInput(String(closest));
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    return () => container.removeEventListener('scroll', onScroll);
  }, [numPages]);

  useEffect(() => {
    if (!visibleComments.length) { setAdjustedPositions({}); setHighlightRects({}); return; }
    const t = setTimeout(() => {
      const newPos: Record<string, number> = {}, newHL: Record<string, HighlightData> = {};
      const byPage: Record<number, PdfComment[]> = {};
      for (const c of visibleComments) { if (!byPage[c.page]) byPage[c.page] = []; byPage[c.page].push(c); }
      for (const [ps, pageComments] of Object.entries(byPage)) {
        const pageNum = parseInt(ps, 10), pageEl = pageRefs.current[pageNum];
        if (!pageEl) continue;
        const pdfEl = pageEl.querySelector('.react-pdf__Page') as HTMLElement | null;
        const pageHeight = pdfEl?.offsetHeight || ESTIMATED_PAGE_HEIGHT;
        const pageRect = pageEl.getBoundingClientRect();
        let lastBottom = 0;
        [...pageComments].sort((a, b) => (a.topRatio || 0) - (b.topRatio || 0)).forEach((c) => {
          let top = pageEl.offsetTop + (c.topRatio || 0) * pageHeight;
          const cardH = commentsRef.current[c.id]?.offsetHeight || 80;
          if (top < lastBottom + 12) top = lastBottom + 12;
          newPos[c.id] = top; lastBottom = top + cardH;
        });
        const textLayer = pdfEl?.querySelector('.react-pdf__Page__textContent');
        if (!textLayer) continue;
        const spans = textLayer.querySelectorAll('span');
        pageComments.forEach((c) => {
          if (!c.selectedText) return;
          const expectedTop = (c.topRatio || 0) * pageHeight, tol = pageHeight * 0.05;
          const rects: HighlightRect[] = [];
          for (const span of spans) {
            const st = span.textContent || ''; if (!st.trim()) continue;
            const sr = span.getBoundingClientRect(), relTop = sr.top - pageRect.top;
            if (Math.abs(relTop - expectedTop) > tol) continue;
            const idx = st.indexOf(c.selectedText); if (idx === -1) continue;
            const tn = span.firstChild; if (!tn || tn.nodeType !== Node.TEXT_NODE) continue;
            try {
              const range = document.createRange();
              range.setStart(tn, Math.min(idx, (tn as Text).length));
              range.setEnd(tn, Math.min(idx + c.selectedText.length, (tn as Text).length));
              for (const cr of range.getClientRects())
                rects.push({ top: cr.top - pageRect.top, left: cr.left - pageRect.left, width: cr.width, height: cr.height });
            } catch { rects.push({ top: relTop, left: sr.left - pageRect.left, width: sr.width, height: sr.height }); }
          }
          if (rects.length) newHL[c.id] = { rects, pageNum };
        });
      }
      setAdjustedPositions(newPos); setHighlightRects(newHL);
    }, 350);
    return () => clearTimeout(t);
  }, [visibleComments, pageWidth, visiblePages]);

  const handleLoadSuccess = useCallback(({ numPages: n }: { numPages: number }) => {
    setNumPages(n); setCurrentPage(1); setPageInput('1');
    const init = new Set<number>();
    for (let i = 1; i <= Math.min(n, 1 + PAGE_BUFFER); i++) init.add(i);
    setVisiblePages(init);
  }, []);

  const handlePageLoadSuccess = useCallback(
    (pageNum: number) => (page: { width: number; height: number }) =>
      setPageDimensions((prev) => ({ ...prev, [pageNum]: { width: page.width, height: page.height } })),
    [],
  );

  const scrollToPage = useCallback((n: number) => {
    pageRefs.current[n]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const handlePageInputSubmit = useCallback(() => {
    const n = parseInt(pageInput, 10);
    if (n >= 1 && n <= (numPages || 1)) scrollToPage(n); else setPageInput(String(currentPage));
  }, [pageInput, numPages, currentPage, scrollToPage]);

  useEffect(() => {
    const el = scrollContainerRef.current; if (!el) return;
    const handler = (e: WheelEvent) => {
      if (!e.ctrlKey) return; e.preventDefault();
      const ratio = el.scrollHeight > 0 ? el.scrollTop / el.scrollHeight : 0;
      setZoomPercent((prev) => {
        const next = Math.min(300, Math.max(30, prev + (e.deltaY > 0 ? -10 : 10)));
        requestAnimationFrame(() => { el.scrollTop = ratio * el.scrollHeight; });
        return next;
      });
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  const handleMouseUp = useCallback(() => {
    const sel = window.getSelection(), text = sel?.toString().trim();
    if (!text || !scrollContainerRef.current) { setShowCommentButton(false); return; }
    let pageNum: number | null = null, pageEl: HTMLDivElement | null = null;
    for (let i = 1; i <= (numPages || 0); i++) {
      const ref = pageRefs.current[i];
      if (ref?.contains(sel!.anchorNode)) { pageNum = i; pageEl = ref; break; }
    }
    if (!pageNum || !pageEl) { setShowCommentButton(false); return; }
    const range = sel!.getRangeAt(0), rect = range.getBoundingClientRect();
    const pageRect = pageEl.getBoundingClientRect();
    const pdfEl = pageEl.querySelector('.react-pdf__Page') as HTMLElement | null;
    const pageHeight = pdfEl?.offsetHeight || pageRect.height || ESTIMATED_PAGE_HEIGHT;
    const relativeTop = rect.top - pageRect.top;
    const scrollRect = scrollContainerRef.current!.getBoundingClientRect();
    setCommentButtonPos({ top: rect.top - scrollRect.top + scrollContainerRef.current.scrollTop - 36, left: rect.left - scrollRect.left + rect.width / 2 - 16 });
    setSelectedTextInfo({ text, topRatio: relativeTop / pageHeight, relativeTop, page: pageNum });
    setShowCommentButton(true);
  }, [numPages]);

  const handleStartComment = useCallback(() => {
    if (!selectedTextInfo) return;
    const pageEl = pageRefs.current[selectedTextInfo.page]; if (!pageEl) return;
    setCommentInputTop(pageEl.offsetTop + selectedTextInfo.relativeTop);
    setShowCommentInput(true); setShowCommentButton(false);
  }, [selectedTextInfo]);

  const addComment = useCallback(async () => {
    if (!commentText.trim() || !selectedTextInfo || !workspacePath || !filePath) return;
    const newId = crypto.randomUUID();
    const ann: PdfComment = { id: newId, page: selectedTextInfo.page, selectedText: selectedTextInfo.text,
      topRatio: selectedTextInfo.topRatio, text: commentText.trim(), type: commentType,
      author: 'user', timestamp: new Date().toISOString() };
    setComments((prev) => [...prev, ann]);
    frameService.addAnnotation(workspacePath, filePath, { id: newId, page: ann.page,
      selectedText: ann.selectedText, topRatio: ann.topRatio, text: ann.text, type: ann.type, author: 'user' })
      .catch((e) => console.warn('PDF comment sync failed:', e));
    setCommentText(''); setCommentType('comment'); setShowCommentInput(false); setSelectedTextInfo(null);
    window.getSelection()?.removeAllRanges();
  }, [commentText, commentType, selectedTextInfo, workspacePath, filePath, frameService]);

  const cancelComment = useCallback(() => {
    setCommentText(''); setCommentType('comment'); setShowCommentInput(false); setSelectedTextInfo(null);
  }, []);

  const handleUpdateCommentType = useCallback(async (id: string, newType: PdfAnnotationType) => {
    setComments((prev) => prev.map((c) => c.id === id ? { ...c, type: newType } : c));
    if (workspacePath && filePath)
      frameService.updateAnnotationType(workspacePath, filePath, id, newType).catch(console.warn);
  }, [workspacePath, filePath, frameService]);

  const resolveComment = useCallback(async (id: string) => {
    setComments((prev) => prev.filter((c) => c.id !== id));
    if (workspacePath && filePath)
      frameService.removeAnnotation(workspacePath, filePath, id).catch(console.warn);
  }, [workspacePath, filePath, frameService]);

  const getPageHeight = useCallback((pageNum: number) => {
    const d = pageDimensions[pageNum];
    return d ? pageWidth * (d.height / d.width) : pageWidth * (11 / 8.5);
  }, [pageDimensions, pageWidth]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-bg-surface">
      <div className="flex items-center justify-center gap-4 px-4 py-2 bg-bg-elevated border-b border-border">
        <div className="flex items-center gap-1">
          <input type="text" value={pageInput} onChange={(e) => setPageInput(e.target.value)}
            onBlur={handlePageInputSubmit} onKeyDown={(e) => { if (e.key === 'Enter') handlePageInputSubmit(); }}
            className="w-10 text-center text-sm text-text-primary bg-bg-surface border border-border rounded px-1 py-0.5 outline-none focus:border-accent" />
          <span className="text-sm text-text-secondary">/ {numPages || '...'}</span>
        </div>
        <div className="w-px h-4 bg-border" />
        <button onClick={() => setZoomPercent((p) => Math.max(30, p - 10))} className="p-1 rounded hover:bg-white/[0.06] text-text-secondary"><MagnifyingGlassMinusIcon size={18} /></button>
        <span className="text-xs text-text-tertiary w-12 text-center">{zoomPercent}%</span>
        <button onClick={() => setZoomPercent((p) => Math.min(300, p + 10))} className="p-1 rounded hover:bg-white/[0.06] text-text-secondary"><MagnifyingGlassPlusIcon size={18} /></button>
      </div>

      <div className="flex-1 overflow-auto py-6 [&::-webkit-scrollbar]:w-2.5 [&::-webkit-scrollbar-thumb]:bg-white/15"
        ref={scrollContainerRef} onMouseUp={handleMouseUp}>
        <div className="relative flex flex-col items-center min-w-fit">
          <Document file={fileUrl} onLoadSuccess={handleLoadSuccess} options={pdfOptions}
            loading={<div className="text-text-tertiary text-sm p-8">Loading PDF...</div>}
            error={<div className="text-error text-sm p-8">Failed to load PDF.</div>}>
            {numPages && Array.from({ length: numPages }, (_, i) => {
              const pageNum = i + 1, isRendered = renderedPages.has(pageNum);
              return (
                <div key={pageNum} ref={(el: HTMLDivElement | null) => { pageRefs.current[pageNum] = el; }}
                  data-page-number={pageNum} className="relative" style={{ marginBottom: PAGE_GAP }}>
                  {isRendered ? (
                    <Page pageNumber={pageNum} width={pageWidth}
                      devicePixelRatio={Math.max(window.devicePixelRatio * 1.5 || 2, (100 / zoomPercent) * (window.devicePixelRatio * 1.5 || 2))}
                      className="shadow-lg" onLoadSuccess={handlePageLoadSuccess(pageNum)}
                      error={<div className="p-4 text-error text-sm">Failed to render page {pageNum}</div>} />
                  ) : (
                    <div className="bg-bg-elevated shadow-lg flex items-center justify-center text-text-tertiary text-sm"
                      style={{ width: pageWidth, height: getPageHeight(pageNum) }}>Page {pageNum}</div>
                  )}
                  {Object.entries(highlightRects).filter(([, d]) => d.pageNum === pageNum)
                    .map(([cId, d]) => d.rects.map((r, ri) => (
                      <div key={`hl-${cId}-${ri}`} className="absolute bg-accent/20 pointer-events-none rounded-sm"
                        style={{ top: r.top, left: r.left, width: r.width, height: r.height }} />
                    )))}
                </div>
              );
            })}
          </Document>

          {showCommentButton && (
            <button className="absolute z-50 p-1.5 rounded-lg bg-accent text-white shadow-lg hover:bg-accent-hover transition-colors"
              style={{ top: commentButtonPos.top, left: commentButtonPos.left }}
              onMouseDown={(e) => e.preventDefault()} onClick={handleStartComment} title="Add comment">
              <ChatTextIcon size={18} />
            </button>
          )}

          <div className="absolute top-0 bottom-0 w-[300px] pointer-events-none"
            style={{ left: `calc(50% + ${pageWidth / 2}px + 16px)` }}>
            {showCommentInput && (
              <div className="absolute w-[280px] bg-bg-surface rounded-lg shadow-lg p-3 pointer-events-auto border border-accent z-[100]"
                style={{ top: commentInputTop }}>
                <textarea value={commentText} onChange={(e) => setCommentText(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.ctrlKey || e.metaKey || e.shiftKey) && e.key === 'Enter') { e.preventDefault(); addComment(); }
                    if (e.key === 'Escape') cancelComment();
                  }}
                  placeholder="Type your comment..." autoFocus
                  className="w-full border border-border rounded py-2 px-2 font-[inherit] text-sm resize-y min-h-[60px] outline-none mb-2 text-page-text focus:border-accent" />
                <div className="flex items-center justify-between gap-2">
                  <select value={commentType} onChange={(e) => setCommentType(e.target.value as PdfAnnotationType)}
                    className="text-[11px] bg-bg-elevated border border-border rounded px-1.5 py-1 text-text-secondary outline-none cursor-pointer">
                    {ANNOTATION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <div className="flex gap-2">
                    <button onClick={cancelComment} onMouseDown={(e) => e.preventDefault()} className="py-1.5 px-3 rounded text-[13px] font-medium bg-transparent text-text-tertiary hover:bg-bg-elevated">Cancel</button>
                    <button onClick={addComment} onMouseDown={(e) => e.preventDefault()} className="py-1.5 px-3 rounded text-[13px] font-medium bg-accent text-white hover:bg-accent-hover">Comment</button>
                  </div>
                </div>
              </div>
            )}
            {visibleComments.map((c) => (
              <div key={c.id} ref={(el: HTMLDivElement | null) => { commentsRef.current[c.id] = el; }}
                className="absolute w-[280px] bg-bg-surface rounded-lg shadow-md p-3 pointer-events-auto border border-transparent hover:shadow-lg"
                style={{
                  top: adjustedPositions[c.id] !== undefined ? adjustedPositions[c.id]
                    : (pageRefs.current[c.page]?.offsetTop || 0) + (c.topRatio || 0) *
                      ((pageRefs.current[c.page]?.querySelector('.react-pdf__Page') as HTMLElement | null)?.offsetHeight || ESTIMATED_PAGE_HEIGHT),
                  transition: 'top 0.3s ease-out',
                }}>
                <div className="flex justify-between mb-1 text-xs">
                  <select value={c.type || 'comment'} onChange={(e) => handleUpdateCommentType(c.id, e.target.value as PdfAnnotationType)}
                    className={`px-1 py-0.5 rounded text-[10px] font-medium border-none outline-none cursor-pointer ${TYPE_COLORS[c.type] || TYPE_COLORS.comment}`}>
                    {ANNOTATION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                  <div className="flex gap-2 items-center">
                    <span className="text-text-secondary">p.{c.page}</span>
                    <button className="border-none bg-transparent text-text-secondary cursor-pointer py-0.5 px-1.5 rounded hover:bg-bg-elevated hover:text-page-text"
                      onClick={() => resolveComment(c.id)} onMouseDown={(e) => e.preventDefault()} title="Resolve comment">
                      <XIcon size={14} />
                    </button>
                  </div>
                </div>
                <div className="text-sm text-page-text mb-2 whitespace-pre-wrap">{c.text}</div>
                <div className="text-xs text-text-secondary border-l-2 border-warning pl-2 italic whitespace-nowrap overflow-hidden text-ellipsis">"{c.selectedText}"</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default PdfViewer;
