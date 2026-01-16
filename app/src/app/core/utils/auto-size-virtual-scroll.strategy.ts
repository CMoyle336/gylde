import { Injectable } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { distinctUntilChanged } from 'rxjs/operators';
import { CdkVirtualScrollViewport, VirtualScrollStrategy } from '@angular/cdk/scrolling';
import { ListRange } from '@angular/cdk/collections';

/**
 * Virtual scroll strategy for items with variable/unknown heights.
 * This strategy measures item heights after rendering and caches them
 * for accurate scroll positioning.
 */
@Injectable()
export class AutoSizeVirtualScrollStrategy implements VirtualScrollStrategy {
  /** Average item height used for initial estimates */
  private averageItemHeight = 80;
  
  /** Spacing between items in pixels */
  private readonly itemSpacing = 14; // 0.875rem
  
  /** Minimum buffer in pixels to render beyond the viewport */
  private minBufferPx = 200;
  
  /** Maximum buffer in pixels to render beyond the viewport */
  private maxBufferPx = 400;
  
  /** The attached viewport */
  private viewport: CdkVirtualScrollViewport | null = null;
  
  /** Cache of measured item heights by index */
  private itemHeights = new Map<number, number>();
  
  /** Subject for scroll index changes */
  private readonly indexChange = new Subject<number>();
  
  /** Observable that emits when the scroll index changes */
  readonly scrolledIndexChange: Observable<number> = this.indexChange.pipe(distinctUntilChanged());
  
  /** Last rendered range */
  private lastRenderedRange: ListRange = { start: 0, end: 0 };

  constructor() {}

  /**
   * Update the buffer sizes
   */
  updateBufferSize(minBufferPx: number, maxBufferPx: number): void {
    this.minBufferPx = minBufferPx;
    this.maxBufferPx = maxBufferPx;
    if (this.viewport) {
      this.updateRenderedRange();
    }
  }

  /**
   * Attach this scroll strategy to a viewport.
   */
  attach(viewport: CdkVirtualScrollViewport): void {
    this.viewport = viewport;
    this.itemHeights.clear();
    this.lastRenderedRange = { start: 0, end: 0 };
    
    // Initial update
    this.onDataLengthChanged();
  }

  /**
   * Detach this scroll strategy from the currently attached viewport.
   */
  detach(): void {
    this.indexChange.complete();
    this.viewport = null;
    this.itemHeights.clear();
  }

  /**
   * Called when the viewport is scrolled.
   */
  onContentScrolled(): void {
    if (!this.viewport) return;
    this.updateRenderedRange();
  }

  /**
   * Called when the length of the data changes.
   */
  onDataLengthChanged(): void {
    if (!this.viewport) return;
    
    const dataLength = this.viewport.getDataLength();
    
    // Clear height cache when data changes significantly
    if (dataLength === 0) {
      this.itemHeights.clear();
    }
    
    this.updateTotalContentSize();
    this.updateRenderedRange();
  }

  /**
   * Called when the range of rendered items changes.
   */
  onContentRendered(): void {
    if (!this.viewport) return;
    
    // Measure rendered items and cache their heights
    this.measureRenderedItems();
    
    // Update total content size based on new measurements
    this.updateTotalContentSize();
  }

  /**
   * Called when the offset of the rendered content changes.
   */
  onRenderedOffsetChanged(): void {
    // No action needed
  }

  /**
   * Scroll to the given index.
   */
  scrollToIndex(index: number, behavior: ScrollBehavior = 'auto'): void {
    if (!this.viewport) return;
    
    const offset = this.getOffsetForIndex(index);
    this.viewport.scrollToOffset(offset, behavior);
  }

  /**
   * Measure the heights of currently rendered items.
   */
  private measureRenderedItems(): void {
    if (!this.viewport) return;
    
    const range = this.viewport.getRenderedRange();
    const contentWrapper = this.viewport.getElementRef().nativeElement.querySelector(
      '.cdk-virtual-scroll-content-wrapper'
    );
    
    if (!contentWrapper) return;
    
    const children = contentWrapper.children;
    let totalMeasured = 0;
    let countMeasured = 0;
    
    for (let i = 0; i < children.length; i++) {
      const child = children[i] as HTMLElement;
      const index = range.start + i;
      const height = child.getBoundingClientRect().height;
      
      if (height > 0) {
        this.itemHeights.set(index, height);
        totalMeasured += height;
        countMeasured++;
      }
    }
    
    // Update average based on measurements
    if (countMeasured > 0) {
      const currentAverage = totalMeasured / countMeasured;
      // Smooth the average to avoid jumps
      this.averageItemHeight = this.averageItemHeight * 0.7 + currentAverage * 0.3;
    }
  }

  /**
   * Get the estimated offset for a given index.
   */
  private getOffsetForIndex(index: number): number {
    let offset = 0;
    
    for (let i = 0; i < index; i++) {
      offset += this.getItemHeight(i);
    }
    
    return offset;
  }

  /**
   * Get the height of an item (measured or estimated) plus spacing.
   */
  private getItemHeight(index: number): number {
    const baseHeight = this.itemHeights.get(index) ?? this.averageItemHeight;
    return baseHeight + this.itemSpacing;
  }

  /**
   * Get the total content size.
   */
  private getTotalContentSize(): number {
    if (!this.viewport) return 0;
    
    const dataLength = this.viewport.getDataLength();
    let total = 0;
    
    for (let i = 0; i < dataLength; i++) {
      total += this.getItemHeight(i);
    }
    
    return total;
  }

  /**
   * Update the total content size in the viewport.
   */
  private updateTotalContentSize(): void {
    if (!this.viewport) return;
    
    const totalSize = this.getTotalContentSize();
    this.viewport.setTotalContentSize(totalSize);
  }

  /**
   * Update which items should be rendered based on scroll position.
   */
  private updateRenderedRange(): void {
    if (!this.viewport) return;
    
    const dataLength = this.viewport.getDataLength();
    
    // If no data, set empty range
    if (dataLength === 0) {
      if (this.lastRenderedRange.start !== 0 || this.lastRenderedRange.end !== 0) {
        this.lastRenderedRange = { start: 0, end: 0 };
        this.viewport.setRenderedRange(this.lastRenderedRange);
        this.viewport.setRenderedContentOffset(0);
      }
      return;
    }
    
    const scrollOffset = this.viewport.measureScrollOffset();
    const viewportSize = this.viewport.getViewportSize();
    
    // Handle case where viewport isn't sized yet
    if (viewportSize === 0) {
      // Render first batch anyway
      const initialEnd = Math.min(dataLength, 20);
      if (this.lastRenderedRange.end !== initialEnd) {
        this.lastRenderedRange = { start: 0, end: initialEnd };
        this.viewport.setRenderedRange(this.lastRenderedRange);
        this.viewport.setRenderedContentOffset(0);
        this.indexChange.next(0);
      }
      return;
    }
    
    // Find the first visible item
    let currentOffset = 0;
    let startIndex = 0;
    
    for (let i = 0; i < dataLength; i++) {
      const itemHeight = this.getItemHeight(i);
      
      if (currentOffset + itemHeight > scrollOffset - this.maxBufferPx) {
        startIndex = i;
        break;
      }
      
      currentOffset += itemHeight;
    }
    
    // Find the last visible item
    let endIndex = startIndex;
    const endOffset = scrollOffset + viewportSize + this.maxBufferPx;
    let runningOffset = currentOffset;
    
    for (let i = startIndex; i < dataLength; i++) {
      endIndex = i + 1;
      runningOffset += this.getItemHeight(i);
      
      if (runningOffset >= endOffset) {
        break;
      }
    }
    
    // Ensure we render at least some items
    if (endIndex <= startIndex) {
      endIndex = Math.min(dataLength, startIndex + 10);
    }
    
    const range: ListRange = { start: startIndex, end: endIndex };
    
    // Only update if range changed
    if (range.start !== this.lastRenderedRange.start || range.end !== this.lastRenderedRange.end) {
      this.lastRenderedRange = range;
      this.viewport.setRenderedRange(range);
      this.viewport.setRenderedContentOffset(this.getOffsetForIndex(startIndex));
      this.indexChange.next(startIndex);
    }
  }
}
