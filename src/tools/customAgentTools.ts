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

      //response.addCode(`// Get computed styles for ${params.element}`);
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

        //response.addCode(`// Extract SVG content from ${params.element}`);
        const svgContent = await locator.evaluate(extractSvgFunction, { extractMethod, includeStyles, minifyOutput });
        response.addResult(svgContent.svgContent);

      } catch (error) {
        //response.addCode(`// Failed to extract SVG from ${params.element}`);
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

        //response.addCode(`// Extract image URLs from ${params.element}`);
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
        //response.addCode(`// Failed to extract image URLs from ${params.element}`);
        const errorMessage = `Failed to extract image URLs from ${element}. Error: ${error instanceof Error ? error.message : String(error)}`;
        response.addResult(errorMessage);
      }
    });
  },
});

const styleCheckSchema = z.object({
  name: z.string().describe(
    "CSS property name to validate (supports kebab-case or camelCase, e.g. 'color' or 'backgroundColor')"
  ),
  operator: z
    .enum(["isEqual", "notEqual", "inRange"])
    .describe(
      "Validation operator: 'isEqual' checks strict equality, 'notEqual' checks strict inequality, 'inRange' checks if value is in list or RGB color is within specified range"
    ),
  expected: z.union([
    z.string(),
    z.array(z.string()),
    z.object({
      minR: z.number().min(0).max(255).describe("Minimum red value (0-255)"),
      maxR: z.number().min(0).max(255).describe("Maximum red value (0-255)"),
      minG: z.number().min(0).max(255).describe("Minimum green value (0-255)"),
      maxG: z.number().min(0).max(255).describe("Maximum green value (0-255)"),
      minB: z.number().min(0).max(255).describe("Minimum blue value (0-255)"),
      maxB: z.number().min(0).max(255).describe("Maximum blue value (0-255)"),
    })
  ]).describe(
    "Expected value(s) for the CSS property. Can be a single string, array of strings for 'inRange' operator, or RGB range object for RGB color validation."
  ),
});

export const validateStylesSchema = z.object({
  element: z
    .string()
    .describe(
      "Human-readable element description used to obtain permission to interact with the element"
    ),
  ref: z
    .string()
    .describe("Exact target element reference from the page snapshot"),
  checks: z
    .array(styleCheckSchema)
    .min(1)
    .describe(
      "List of style validation checks to perform on the target element"
    ),
});


const camelToKebab = (prop: string) =>
  prop.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);

function pickActualValue(
  all: Record<string, string>,
  name: string
): string | undefined {
  if (name in all) return all[name];
  const kebab = camelToKebab(name);
  if (kebab in all) return all[kebab];
  const trimmed = name.trim();
  if (trimmed in all) return all[trimmed];
  const trimmedKebab = camelToKebab(trimmed);
  if (trimmedKebab in all) return all[trimmedKebab];
  return undefined;
}

// Function to parse RGB color values from various CSS color formats
function parseRGBColor(colorValue: string): { r: number; g: number; b: number } | null {
  if (!colorValue) return null;
  
  // Handle rgb(r, g, b) format
  const rgbMatch = colorValue.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (rgbMatch) {
    return {
      r: parseInt(rgbMatch[1]),
      g: parseInt(rgbMatch[2]),
      b: parseInt(rgbMatch[3])
    };
  }
  
  // Handle rgba(r, g, b, a) format (ignore alpha)
  const rgbaMatch = colorValue.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*[\d.]+\)/);
  if (rgbaMatch) {
    return {
      r: parseInt(rgbaMatch[1]),
      g: parseInt(rgbaMatch[2]),
      b: parseInt(rgbaMatch[3])
    };
  }
  
  // Handle hex colors (#RRGGBB or #RGB)
  const hexMatch = colorValue.match(/#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})/);
  if (hexMatch) {
    const hex = hexMatch[1];
    if (hex.length === 3) {
      // #RGB format
      return {
        r: parseInt(hex[0] + hex[0], 16),
        g: parseInt(hex[1] + hex[1], 16),
        b: parseInt(hex[2] + hex[2], 16)
      };
    } else {
      // #RRGGBB format
      return {
        r: parseInt(hex.substring(0, 2), 16),
        g: parseInt(hex.substring(2, 4), 16),
        b: parseInt(hex.substring(4, 6), 16)
      };
    }
  }
  
  // Handle named colors (basic support)
  const namedColors: Record<string, { r: number; g: number; b: number }> = {
    'red': { r: 255, g: 0, b: 0 },
    'green': { r: 0, g: 128, b: 0 },
    'blue': { r: 0, g: 0, b: 255 },
    'black': { r: 0, g: 0, b: 0 },
    'white': { r: 255, g: 255, b: 255 },
    'gray': { r: 128, g: 128, b: 128 },
    'grey': { r: 128, g: 128, b: 128 },
    'yellow': { r: 255, g: 255, b: 0 },
    'cyan': { r: 0, g: 255, b: 255 },
    'magenta': { r: 255, g: 0, b: 255 },
    'orange': { r: 255, g: 165, b: 0 },
    'purple': { r: 128, g: 0, b: 128 },
    'pink': { r: 255, g: 192, b: 203 },
    'brown': { r: 165, g: 42, b: 42 },
    'darkred': { r: 139, g: 0, b: 0 },
    'lightblue': { r: 173, g: 216, b: 230 },
    'darkblue': { r: 0, g: 0, b: 139 },
    'lightgreen': { r: 144, g: 238, b: 144 },
    'darkgreen': { r: 0, g: 100, b: 0 }
  };
  
  const lowerColor = colorValue.toLowerCase().trim();
  if (namedColors[lowerColor]) {
    return namedColors[lowerColor];
  }
  
  return null;
}

// Function to check if RGB color is within specified range
function isColorInRange(actualColor: string, range: { minR: number; maxR: number; minG: number; maxG: number; minB: number; maxB: number }): boolean {
  const rgb = parseRGBColor(actualColor);
  if (!rgb) return false;
  
  return rgb.r >= range.minR && rgb.r <= range.maxR &&
         rgb.g >= range.minG && rgb.g <= range.maxG &&
         rgb.b >= range.minB && rgb.b <= range.maxB;
}


async function getAllComputedStylesDirect(
  tab: any,
  ref: string,
  element: string
): Promise<Record<string, string>> {
  const locator = await tab.refLocator({ ref, element });

  const allStyles: Record<string, string> = await locator.evaluate(
    (el: Element) => {
      const cs = window.getComputedStyle(el);
      const out: Record<string, string> = {};
      for (let i = 0; i < cs.length; i++) {
        const name = cs[i]; // kebab-case
        out[name] = cs.getPropertyValue(name);
      }
      return out;
    }
  );

  return allStyles;
}

const validate_computed_styles = defineTabTool({
  capability: "core",
  schema: {
    name: "validate_computed_styles",
    title: "Validate computed styles of element",
    description:
      "Validate element's computed styles against expected values using isEqual / notEqual / inRange operators. Supports RGB color range validation for color properties.",
    inputSchema: validateStylesSchema,
    type: "readOnly",
  },
  handle: async (tab, rawParams, response) => {
    const { ref, element, checks } = validateStylesSchema.parse(rawParams);

    await tab.waitForCompletion(async () => {
      // 1) Get all computed styles directly
      const allStyles = await getAllComputedStylesDirect(tab, ref, element);
      //console.log("All Computed Styles:", allStyles);
      // 2) Validate rules
      const results = checks.map((c) => {
        const actual = pickActualValue(allStyles, c.name);
        
        let passed: boolean;
        if (c.operator === "isEqual") {
          // isEqual operator: strict equality only
          if (typeof c.expected === 'string' && (c.name.toLowerCase().includes('color') || c.name.toLowerCase().includes('background'))) {
            // For color properties, check if expected is in RGB format
            const expectedRGB = parseRGBColor(c.expected);
            const actualRGB = parseRGBColor(actual || '');
            
            if (expectedRGB && actualRGB) {
              // Compare RGB values with some tolerance for minor variations
              const tolerance = 5; // Allow small variations in RGB values
              passed = Math.abs(expectedRGB.r - actualRGB.r) <= tolerance &&
                      Math.abs(expectedRGB.g - actualRGB.g) <= tolerance &&
                      Math.abs(expectedRGB.b - actualRGB.b) <= tolerance;
            } else {
              // Fallback to strict equality if RGB parsing fails
              passed = actual === c.expected;
            }
          } else {
            // For non-color properties: strict equality
            passed = actual === c.expected;
          }
        } else if (c.operator === "notEqual") {
          // notEqual operator: strict inequality
          passed = actual !== c.expected;
        } else if (c.operator === "inRange") {
          // inRange operator: check if value is in list or RGB color is within range
          if (Array.isArray(c.expected)) {
            // For inRange with array: any matching value passes
            passed = actual !== undefined && c.expected.includes(actual);
          } else if (typeof c.expected === 'object' && 'minR' in c.expected) {
            // For inRange with RGB range object: check if color is within range
            passed = actual !== undefined && isColorInRange(actual, c.expected as { minR: number; maxR: number; minG: number; maxG: number; minB: number; maxB: number });
          } else {
            passed = false; // Invalid expected value - inRange only supports arrays and RGB range objects
          }
        } else {
          passed = false; // Unknown operator
        }

        return {
          style: c.name,
          operator: c.operator,
          expected: c.expected,
          actual,
          result: passed ? "pass" : "fail",
        };
      });

      const passedCount = results.filter((r) => r.result === "pass").length;

      // 3) Answer
      const payload = {
        ref,
        element,
        summary: {
          total: results.length,
          passed: passedCount,
          failed: results.length - passedCount,
          status: passedCount === results.length ? "pass" : "fail",
        },
        checks: results,
      };

      console.log("Validate Computed Styles:", payload);
      response.addResult(JSON.stringify(payload, null, 2));
    });
  },
});




const textValidationSchema = z.object({
  element: z.string().describe(
    "Human-readable element description used to obtain permission to interact with the element"
  ),
  ref: z.string().optional().describe(
    "Exact target element reference from the page snapshot. If not provided, validation will search across the whole page snapshot"
  ),
  expectedText: z.string().describe(
    "Expected text value to validate in the element or whole page"
  ),
  matchType: z.enum(["exact", "contains", "not-contains"]).default("exact").describe(
    "Type of match: 'exact' checks full equality for specific elements, 'contains' checks substring presence, 'not-contains' checks that text is NOT present. When ref is null, always uses 'contains' logic regardless of matchType"
  ),
  caseSensitive: z.boolean().optional().describe(
    "Enable case-sensitive comparison (default false)"
  ),
});

const validate_element_text = defineTabTool({
  capability: "core",
  schema: {
    name: "validate_element_text",
    title: "Validate element text",
    description:
      "Verify that an element's text matches/contains/does not contain expected value. When ref is provided, validates specific element. When ref is null, searches entire page snapshot for text presence.",
    inputSchema: textValidationSchema,
    type: "readOnly",
  },
  handle: async (tab, rawParams, response) => {
    const { ref, element, expectedText, matchType, caseSensitive } =
      textValidationSchema.parse(rawParams);

    await tab.waitForCompletion(async () => {
      let actualText = "";

      if (ref) {
        
        const locator = await tab.refLocator({ ref, element });
        actualText = await locator.evaluate(
          (el: Element) => (el.textContent ?? "").trim()
        );
      } else {
        const snapshotMd: string = await tab.captureSnapshot();
        const yamlMatch = snapshotMd.match(/```yaml([\s\S]*?)```/);
        const yamlContent = yamlMatch ? yamlMatch[1] : snapshotMd;

        actualText = yamlContent;
      }
      // console.log('actualText')
      // console.dir(actualText, { depth: null })
      const norm = (s: string) => (caseSensitive ? s : s.toLowerCase());
      const expected = expectedText;
      
      let passed;
      if (ref) {
        // When ref is provided, validate specific element text
        if (matchType === "exact") {
          passed = norm(actualText) === norm(expected);
        } else if (matchType === "contains") {
          passed = norm(actualText).includes(norm(expected));
        } else if (matchType === "not-contains") {
          passed = !norm(actualText).includes(norm(expected));
        }
      } else {
        // When ref is null, always check if expected text is contained in snapshot
        // This makes more sense than comparing entire snapshot with element text
        if (matchType === "not-contains") {
          passed = !norm(actualText).includes(norm(expected));
        } else {
          passed = norm(actualText).includes(norm(expected));
        }
        
        // // Add debug information when text is not found in snapshot
        // if (!passed && (matchType === "contains" || matchType === "exact")) {
        //   console.log("=== TEXT VALIDATION DEBUG ===");
        //   console.log("Expected text:", expectedText);
        //   console.log("Normalized expected:", norm(expected));
        //   console.log("Match type:", matchType);
        //   console.log("Case sensitive:", caseSensitive);
        //   console.log("Full snapshot content:");
        //   console.log(actualText);
        //   console.log("=== END DEBUG ===");
        // }
      }

      const payload = {
        ref,
        element,
        summary: {
          total: 1,
          passed: passed ? 1 : 0,
          failed: passed ? 0 : 1,
          status: passed ? "pass" : "fail",
        },
        checks: [{
          property: "text",
          operator: matchType,
          expected: expectedText,
          actual: actualText.length > 300 ? actualText.slice(0, 300) + "…" : actualText,
          result: passed ? "pass" : "fail",
        }],
        scope: ref ? "element" : "page",
        matchType,
        caseSensitive: !!caseSensitive,
      };

      console.log("Validate text:", payload);
      response.addResult(JSON.stringify(payload, null, 2));
    });
  },
});


const domPropCheckSchema = z.object({
  name: z.string(), // any DOM property
  operator: z.enum(["isEqual", "notEqual"]).default("isEqual"),
  expected: z.any(), // can be string, number, boolean
});
const domChecksSchema = z.array(domPropCheckSchema).min(1);

const baseDomInputSchema = z.object({
  ref: z.string().min(1),
  element: z.string().min(1), // CSS selector или test-id
});

const validateDomPropsSchema = baseDomInputSchema.extend({
  checks: domChecksSchema,
});

async function getAllDomPropsDirect(tab: any, ref: string, element: string) {
  const locator = await tab.refLocator({ ref, element });

  const props = await locator.evaluate(
    (el: Element) => {
      if (!el) return {};

      const out: Record<string, any> = {};

      // Collect all "own" properties of the element
      for (const key of Object.keys(el)) {
        try {
          const val = (el as any)[key];
          // filter only primitives for readability
          if (["string", "number", "boolean"].includes(typeof val) || val === null) {
            out[key] = val;
          }
        } catch (_) {
          // skip getters with errors
        }
      }

      // + useful attributes
      if (el.getAttributeNames) {
        el.getAttributeNames().forEach((attr: string) => {
          out[`attr:${attr}`] = el.getAttribute(attr);
        });
      }

      // Handle special cases for common attributes
      // For disabled attribute, check both the property and the attribute
      if (el.hasAttribute('disabled')) {
        out['disabled'] = true;
      } else if ((el as any).disabled !== undefined) {
        out['disabled'] = (el as any).disabled;
      }

      // For checked attribute, check both the property and the attribute
      if (el.hasAttribute('checked')) {
        out['checked'] = true;
      } else if ((el as any).checked !== undefined) {
        out['checked'] = (el as any).checked;
      }

      // For value attribute, prioritize the property over attribute
      if ((el as any).value !== undefined) {
        out['value'] = (el as any).value;
      } else if (el.hasAttribute('value')) {
        out['value'] = el.getAttribute('value');
      }

      return out;
    }
  );

  return props ?? {};
}

const validate_dom_properties = defineTabTool({
  capability: "core",
  schema: {
    name: "validate_dom_properties",
    title: "Validate DOM properties of element",
    description:
      "Validate arbitrary DOM properties (like checked, disabled, value, innerText, etc.) against expected values.",
    inputSchema: validateDomPropsSchema,
    type: "readOnly",
  },
  handle: async (tab, rawParams, response) => {
    const { ref, element, checks } = validateDomPropsSchema.parse(rawParams);

    await tab.waitForCompletion(async () => {
      const allProps = await getAllDomPropsDirect(tab, ref, element);
      console.log("All DOM Props:", allProps);

      const results = checks.map((c) => {
        const actual = allProps[c.name];
        let passed: boolean;
        if (c.operator === "isEqual") {
          passed = actual === c.expected;
        } else {
          passed = actual !== c.expected;
        }
        return {
          property: c.name,
          operator: c.operator,
          expected: c.expected,
          actual,
          result: passed ? "pass" : "fail",
        };
      });

      const passedCount = results.filter((r) => r.result === "pass").length;

      // 3) answer
      const payload = {
        ref,
        element,
        summary: {
          total: results.length,
          passed: passedCount,
          failed: results.length - passedCount,
          status: passedCount === results.length ? "pass" : "fail",
        },
        checks: results,
        snapshot: allProps, //all properties for debugging
      };

      console.log("Validate DOM Properties:");
      console.dir(payload, { depth: null });
      response.addResult(JSON.stringify(payload, null, 2));
    });
  },
});

const checkElementInSnapshotSchema = z.object({
  elements: z.array(z.object({
    ref: z.string().describe('Exact target element reference from the page snapshot to check for existence'),
    element: z.string().describe('Human-readable element description for logging purposes'),
  })).min(1).describe('Array of elements to check for existence in the snapshot. Can contain one or multiple elements.'),
});

const check_element_in_snapshot = defineTabTool({
  capability: 'core',
  schema: {
    name: 'check_element_in_snapshot',
    title: 'Check Element(s) in Snapshot',
    description: 'Check if one or multiple elements with specified refs exist in the current page snapshot. Pass elements as an array - single element or multiple elements.',
    inputSchema: checkElementInSnapshotSchema,
    type: 'readOnly',
  },
  handle: async (tab, params, response) => {
    const { elements } = checkElementInSnapshotSchema.parse(params);
    
    await tab.waitForCompletion(async () => {
      try {
        // Get the current snapshot
        const snapshotMd: string = await tab.captureSnapshot();
        
        // Check each element
        const elementResults = elements.map(({ ref, element }) => {
          const refExists = snapshotMd.includes(`[ref=${ref}]`);
          return {
            ref,
            element,
            exists: refExists,
            result: refExists ? "pass" : "fail"
          };
        });
        
        const passedCount = elementResults.filter((r: any) => r.result === "pass").length;
        const overallStatus = passedCount === elements.length ? "pass" : "fail";
        
        const payload = {
          elements: elementResults,
          summary: {
            total: elements.length,
            passed: passedCount,
            failed: elements.length - passedCount,
            status: overallStatus,
            message: overallStatus === "pass" 
              ? `All ${elements.length} elements found in snapshot` 
              : `${passedCount}/${elements.length} elements found in snapshot`
          },
          snapshot: {
            snapshotLength: snapshotMd.length
          }
        };

        console.log("Check elements in snapshot:", payload);
        response.addResult(JSON.stringify(payload, null, 2));
      } catch (error) {
        const errorMessage = `Failed to check elements in snapshot. Error: ${error instanceof Error ? error.message : String(error)}`;
        const errorPayload = {
          elements: elements.map(({ ref, element }) => ({
            ref,
            element,
            exists: false,
            result: "error"
          })),
          summary: {
            status: "error",
            message: errorMessage
          },
          error: error instanceof Error ? error.message : String(error)
        };
        
        console.error("Check elements in snapshot error:", errorPayload);
        response.addResult(JSON.stringify(errorPayload, null, 2));
      }
    });
  },
});

// Function to check if alert dialog is present in snapshot
function hasAlertDialog(snapshotContent: string): boolean {
  // Check for dialog information in the snapshot
  return snapshotContent.includes('### Modal state') &&
      snapshotContent.includes('dialog with message');
}

const checkAlertInSnapshotSchema = z.object({
  element: z.string().describe('Human-readable element description for logging purposes'),
});

const check_alert_in_snapshot = defineTabTool({
  capability: 'core',
  schema: {
    name: 'check_alert_in_snapshot',
    title: 'Check Alert in Snapshot',
    description: 'Check if an alert dialog is present in the current page snapshot',
    inputSchema: checkAlertInSnapshotSchema,
    type: 'readOnly',
  },
  handle: async (tab, params, response) => {
    const { element } = checkAlertInSnapshotSchema.parse(params);

    await tab.waitForCompletion(async () => {
      try {
        // Get the current snapshot
        const snapshotMd: string = await tab.captureSnapshot();
        
        // Check if alert dialog exists in the snapshot
        const alertExists = hasAlertDialog(snapshotMd);
        
        const payload = {
          element,
          alertExists,
          summary: {
            status: alertExists ? "pass" : "fail",
            message: alertExists ? "Alert dialog found in snapshot" : "Alert dialog not found in snapshot"
          },
          snapshot: {
            containsAlert: alertExists,
            snapshotLength: snapshotMd.length
          }
        };

        console.log("Check alert in snapshot:", payload);
        response.addResult(JSON.stringify(payload, null, 2));
      } catch (error) {
        const errorMessage = `Failed to check alert dialog in snapshot. Error: ${error instanceof Error ? error.message : String(error)}`;
        const errorPayload = {
          element,
          alertExists: false,
          summary: {
            status: "error",
            message: errorMessage
          },
          error: error instanceof Error ? error.message : String(error)
        };
        
        console.error("Check alert in snapshot error:", errorPayload);
        response.addResult(JSON.stringify(errorPayload, null, 2));
      }
    });
  },
});


export default [
  get_computed_styles,
  extract_svg_from_element,
  extract_image_urls,
  validate_computed_styles,
  validate_element_text,
  validate_dom_properties,
  check_element_in_snapshot,
  check_alert_in_snapshot
];