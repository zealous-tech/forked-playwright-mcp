import { z } from 'zod';
import { defineTabTool } from './tool.js';
import type * as playwright from 'playwright';

const elementStyleSchema = z.object({
  element: z.string().describe('Human-readable element description used to obtain permission to interact with the element'),
  ref: z.string().describe('Exact target element reference from the page snapshot'),
  propertyNames: z.array(z.string()).optional().describe('Specific CSS property names to retrieve. If not provided, all computed styles will be returned'),
});

const elementImageSchema = z.object({
  element: z.string().describe('Human-readable element description used to obtain permission to interact with the element'),
  ref: z.string().describe('Exact target element reference from the page snapshot'),
  includeBackgroundImages: z.boolean().optional().default(true).describe('Whether to include CSS background images'),
  includeDataUrls: z.boolean().optional().default(false).describe('Whether to include data URLs (base64 images)'),
  searchDepth: z.enum(['current', 'children', 'all']).optional().default('current').describe('Search scope: current element only, direct children, or all descendants'),
});

const elementSvgSchema = z.object({
  element: z.string().describe('Human-readable element description used to obtain permission to interact with the element'),
  ref: z.string().describe('Exact target element reference from the page snapshot'),
  extractMethod: z.enum(['outerHTML', 'innerHTML', 'serializer']).optional().default('outerHTML').describe('Method to extract SVG: outerHTML (full element), innerHTML (content only), or serializer (XMLSerializer)'),
  includeStyles: z.boolean().optional().default(false).describe('Whether to include computed styles in the extracted SVG'),
  minifyOutput: z.boolean().optional().default(false).describe('Whether to minify the SVG output by removing unnecessary whitespace'),
});

const get_computed_styles = defineTabTool({
  capability: 'core',
  schema: {
    name: 'get_computed_styles',
    title: 'Get computed styles of element',
    description: 'Get computed styles of element',
    inputSchema: elementStyleSchema,
    type: 'readOnly',
  },
  handle: async (tab, params, response) => {
    // response.setIncludeSnapshot();

    const { ref, element } = elementStyleSchema.parse(params);
    const result = { ref, element };

    let locator = await tab.refLocator(result);

    await tab.waitForCompletion(async () => {
      const getStylesFunction = (element: Element, props?: string[]) => {
        const computedStyle = window.getComputedStyle(element);
        const result: { [key: string]: string } = {};
        if (props) {
          props.forEach(propName => {
            result[propName] = computedStyle[propName as any] || computedStyle.getPropertyValue(propName);
          });
        }
        return result;
      };

      response.addCode(`// Get computed styles for ${params.element}`);
      const computedStyles = await locator.evaluate(getStylesFunction, params.propertyNames);
      console.log("Requested Computed Styles : ", computedStyles);
      response.addResult(JSON.stringify(computedStyles, null, 2) || 'Couldn\'t get requested styles');
    });
  },
});

const extract_svg_from_element = defineTabTool({
  capability: 'core',
  schema: {
    name: 'extract_svg_from_element',
    title: 'Extract SVG from Element',
    description: 'Extracts SVG content from a specified element on the page',
    inputSchema: elementSvgSchema,
    type: 'readOnly',
  },
  handle: async (tab, params, response) => {
    // response.setIncludeSnapshot();

    const { ref, element, extractMethod, includeStyles, minifyOutput } = elementSvgSchema.parse(params);
    const result = { ref, element };

    let locator: playwright.Locator | undefined;
    locator = await tab.refLocator(result);

    await tab.waitForCompletion(async () => {
      try {
        const extractSvgFunction = (element: Element, options: {
          extractMethod: string;
          includeStyles: boolean;
          minifyOutput: boolean;
        }) => {
          // Check if element is SVG or contains SVG
          let svgElement: SVGElement | null = null;

          if (element.tagName.toLowerCase() === 'svg') {
            svgElement = element as SVGElement;
          } else {
            // Look for SVG child elements
            svgElement = element.querySelector('svg');
          }

          if (!svgElement) {
            throw new Error('No SVG element found in the specified element');
          }

          let extractedContent = '';

          // Extract based on method
          switch (options.extractMethod) {
            case 'innerHTML':
              extractedContent = `<svg${Array.from(svgElement.attributes).map(attr => ` ${attr.name}="${attr.value}"`).join('')}>${svgElement.innerHTML}</svg>`;
              break;
            case 'serializer':
              const serializer = new XMLSerializer();
              extractedContent = serializer.serializeToString(svgElement);
              break;
            case 'outerHTML':
            default:
              extractedContent = svgElement.outerHTML;
              break;
          }

          // Include computed styles if requested
          if (options.includeStyles) {
            const computedStyle = window.getComputedStyle(svgElement);
            const styleString = Array.from(computedStyle).map(prop =>
                `${prop}: ${computedStyle.getPropertyValue(prop)}`
            ).join('; ');

            // Add style attribute to the SVG
            extractedContent = extractedContent.replace('<svg', `<svg style="${styleString}"`);
          }

          // Minify if requested
          if (options.minifyOutput) {
            extractedContent = extractedContent.replace(/\s+/g, ' ').trim();
          }

          return {
            svgContent: extractedContent,
            elementInfo: {
              tagName: svgElement.tagName,
              width: svgElement.getAttribute('width') || svgElement.getBoundingClientRect().width,
              height: svgElement.getAttribute('height') || svgElement.getBoundingClientRect().height,
              viewBox: svgElement.getAttribute('viewBox'),
              classList: Array.from(svgElement.classList),
              id: svgElement.id,
            }
          };
        };

        response.addCode(`// Extract SVG content from ${params.element}`);
        const svgContent = await locator.evaluate(extractSvgFunction, { extractMethod, includeStyles, minifyOutput });
        response.addResult(svgContent.svgContent);

      } catch (error) {
        response.addCode(`// Failed to extract SVG from ${params.element}`);
        const errorMessage = `Failed to extract SVG from ${element}. Error: ${error instanceof Error ? error.message : String(error)}`;
        response.addResult(errorMessage);
      }
    });
  },
});



const extract_image_urls = defineTabTool({
  capability: 'core',
  schema: {
    name: 'extract_image_urls',
    title: 'Extract Image URLs from Element',
    description: 'Extracts all image URLs from a specified element including img src, background images, and other image sources',
    inputSchema: elementImageSchema,
    type: 'readOnly',
  },
  handle: async (tab, params, response) => {
    // response.setIncludeSnapshot();

    const { ref, element, includeBackgroundImages, includeDataUrls, searchDepth } = elementImageSchema.parse(params);
    const result = { ref, element };

    let locator: playwright.Locator | undefined;
    locator = await tab.refLocator(result);

    await tab.waitForCompletion(async () => {
      try {
        const extractImageFunction = (element: Element, options: {
          includeBackgroundImages: boolean;
          includeDataUrls: boolean;
          searchDepth: string;
        }) => {
          const imageUrls: {
            url: string;
            type: 'img' | 'background' | 'srcset' | 'picture' | 'svg' | 'other';
            element: string;
            alt?: string;
            title?: string;
          }[] = [];

          // Helper function to check if URL should be included
          const shouldIncludeUrl = (url: string): boolean => {
            if (!url || url.trim() === '') return false;
            if (!options.includeDataUrls && url.startsWith('data:')) return false;
            return true;
          };

          // Helper function to get element selector
          const getElementSelector = (el: Element): string => {
            if (el.id) return `#${el.id}`;
            if (el.className) return `.${Array.from(el.classList).join('.')}`;
            return el.tagName.toLowerCase();
          };

          // Helper function to extract images from a single element
          const extractFromElement = (el: Element) => {
            // 1. IMG elements
            if (el.tagName === 'IMG') {
              const imgEl = el as HTMLImageElement;
              if (shouldIncludeUrl(imgEl.src)) {
                imageUrls.push({
                  url: imgEl.src,
                  type: 'img',
                  element: getElementSelector(el),
                  alt: imgEl.alt || undefined,
                  title: imgEl.title || undefined,
                });
              }

              // Handle srcset attribute
              if (imgEl.srcset) {
                const srcsetUrls = imgEl.srcset.split(',').map(src => src.trim().split(' ')[0]);
                srcsetUrls.forEach(url => {
                  if (shouldIncludeUrl(url)) {
                    imageUrls.push({
                      url: url,
                      type: 'srcset',
                      element: getElementSelector(el),
                      alt: imgEl.alt || undefined,
                    });
                  }
                });
              }
            }

            // 2. Background images from CSS
            if (options.includeBackgroundImages) {
              const computedStyle = window.getComputedStyle(el);
              const backgroundImage = computedStyle.backgroundImage;

              if (backgroundImage && backgroundImage !== 'none') {
                // Extract URLs from background-image (can have multiple)
                const urlMatches = backgroundImage.match(/url\(['"]?([^'"]*?)['"]?\)/g);
                if (urlMatches) {
                  urlMatches.forEach(match => {
                    const url = match.replace(/url\(['"]?([^'"]*?)['"]?\)/, '$1');
                    if (shouldIncludeUrl(url)) {
                      imageUrls.push({
                        url: url,
                        type: 'background',
                        element: getElementSelector(el),
                      });
                    }
                  });
                }
              }
            }

            // 3. Picture elements
            if (el.tagName === 'PICTURE') {
              const sources = el.querySelectorAll('source');
              sources.forEach(source => {
                if (source.srcset) {
                  const srcsetUrls = source.srcset.split(',').map(src => src.trim().split(' ')[0]);
                  srcsetUrls.forEach(url => {
                    if (shouldIncludeUrl(url)) {
                      imageUrls.push({
                        url: url,
                        type: 'picture',
                        element: getElementSelector(el),
                      });
                    }
                  });
                }
              });
            }

            // 4. SVG elements with image elements inside
            if (el.tagName === 'SVG') {
              const imageElements = el.querySelectorAll('image');
              imageElements.forEach(img => {
                const href = img.getAttribute('href') || img.getAttribute('xlink:href');
                if (href && shouldIncludeUrl(href)) {
                  imageUrls.push({
                    url: href,
                    type: 'svg',
                    element: getElementSelector(el),
                  });
                }
              });
            }

            // 5. Other elements with image-related attributes
            ['data-src', 'data-original', 'data-lazy-src', 'poster'].forEach(attr => {
              const value = el.getAttribute(attr);
              if (value && shouldIncludeUrl(value)) {
                imageUrls.push({
                  url: value,
                  type: 'other',
                  element: getElementSelector(el),
                });
              }
            });
          };

          // Extract based on search depth
          switch (options.searchDepth) {
            case 'current':
              extractFromElement(element);
              break;
            case 'children':
              extractFromElement(element);
              Array.from(element.children).forEach(extractFromElement);
              break;
            case 'all':
              extractFromElement(element);
              const allElements = element.querySelectorAll('*');
              Array.from(allElements).forEach(extractFromElement);
              break;
          }

          // Remove duplicates
          const uniqueImages = imageUrls.filter((img, index, self) =>
              index === self.findIndex(i => i.url === img.url && i.type === img.type)
          );

          return {
            totalFound: uniqueImages.length,
            images: uniqueImages,
            searchDepth: options.searchDepth,
            includeBackgroundImages: options.includeBackgroundImages,
            includeDataUrls: options.includeDataUrls,
          };
        };

        response.addCode(`// Extract image URLs from ${params.element}`);
        const imageData = await locator.evaluate(extractImageFunction, { includeBackgroundImages, includeDataUrls, searchDepth });
        console.log("Extracted Image URLs: ", imageData);

        const summary = `Found ${imageData.totalFound} image(s) in ${element}:\n\n` +
            imageData.images.map((img, index) =>
                `${index + 1}. [${img.type.toUpperCase()}] ${img.url}\n` +
                `   Element: ${img.element}` +
                (img.alt ? `\n   Alt: ${img.alt}` : '') +
                (img.title ? `\n   Title: ${img.title}` : '')
            ).join('\n\n');

        response.addResult(JSON.stringify(imageData));

      } catch (error) {
        response.addCode(`// Failed to extract image URLs from ${params.element}`);
        const errorMessage = `Failed to extract image URLs from ${element}. Error: ${error instanceof Error ? error.message : String(error)}`;
        response.addResult(errorMessage);
      }
    });
  },
});

export default [
  get_computed_styles,
  extract_svg_from_element,
  extract_image_urls
];