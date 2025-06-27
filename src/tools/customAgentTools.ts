import { z } from 'zod';
import { defineTool } from './tool.js';
import { generateLocator } from './utils.js';





const elementSchema = z.object({
  element: z.string().describe('Human-readable element description used to obtain permission to interact with the element'),
  label: z.string().describe('Exact label name extracted from action'),
});

const custom_browser_click_on_labeled_element = defineTool({
  capability: 'core',
  schema: {
    name: 'custom_browser_click_on_labeled_element',
    title: 'Click',
    description: 'Perform click on a specific label of the page',
    inputSchema: elementSchema,
    type: 'destructive',
  },

  handle: async (context, params) => {
    const tab = context.currentTabOrDie();
    const element = tab.page.locator(`[label='${params.label}']`);
    const code = [
      `// Click on ${params.element} having  ${params.label}`,
    ];

    return {
      code,
      action: () => element.click(),
      captureSnapshot: true,
      waitForNetwork: true,
    };
  },
});




/**
 * Get the title of the current page.
 */
export const custom_click_on_available_section = defineTool({
  capability: 'core',
  schema: {
    name: 'custom_click_on_available_section',
    title: 'Click on Available Section',
    description: 'Finds and clicks on available section',
    inputSchema: z.object({}),
    type: 'destructive',
  },

  handle: async (context, params) => {
    const page = context.currentTabOrDie().page;

    // Use locator() instead of querySelector()
    const mapElement = page.locator('.seatmap-viewer');
    // Use getAttribute() on the ElementHandle, not directly on locator
    const mapId = await mapElement.getAttribute('data-viewerid');

    // Access the map object using the mapID from the window.DvmViewers
    const items = await page.evaluate((mapId) => {
      // Add null check before using mapId
      if (!mapId) {
        throw new Error("Could not find data-viewerid attribute on seatmap-viewer element");
      }
      const map = (window as any).DvmViewers[mapId];
      const nodes = map.getNodesByType("section").filter((item: { [x: string]: string; }) =>
        item["state"] === "available" && item["tag"] === "none"
      );
      const nodeId = nodes[0].id;

      const mapCoordinates = map.getContainer().getBoundingClientRect();
      const nodeCoordinates = map.getNodeById(nodeId).getBoundingClientRect();

      const x = nodeCoordinates["x"] - mapCoordinates["x"] + nodeCoordinates["width"] / 2;
      const y = nodeCoordinates["y"] - mapCoordinates["y"] + nodeCoordinates["height"] / 2;

      return { x, y, nodeId };
    }, mapId);

    const xCoord = Math.floor(items.x);
    const yCoord = Math.floor(items.y);

    // Click at the calculated coordinates
    const selector = ".seatmap-viewer .d2m-map-layer";
    const element = page.locator(selector);
    await element.click({ position: { x: xCoord, y: yCoord } });

    const code = [
      `// Clicks on Available Section`,
      `Internal Code`
    ];

    return {
      code,
      result: items.nodeId,
      captureSnapshot: false,
      waitForNetwork: false,
    };
  },
});




const elementStyleSchema = z.object({
  element: z.string().describe('Human-readable element description used to obtain permission to interact with the element'),
  ref: z.string().describe('Exact target element reference from the page snapshot'),
  propertyNames: z.array(z.string()).optional().describe('Specific CSS property names to retrieve. If not provided, all computed styles will be returned'),
});



const custom_get_computed_styles = defineTool({
  capability: 'core',
  schema: {
    name: 'custom_get_computed_styles',
    title: 'Get console messages',
    description: 'Returns all console messages',
    inputSchema: elementStyleSchema,
    type: 'readOnly',
  },
  handle: async (context, params) => {
    const tab = context.currentTabOrDie();
    const { ref, element } = elementStyleSchema.parse(params);
    const result = { ref, element };

    const locator = tab.snapshotOrDie().refLocator(result);
    const code = [
      `// Get computed styles for ${params.element}`,
    ];

    const computedStyles = await locator.evaluate((element: Element, props?: string[]) => {
      const computedStyle = window.getComputedStyle(element);
      const result: { [key: string]: string } = {};

      if (props) {
        props.forEach(propName => {
          result[propName] = computedStyle[propName as any] || computedStyle.getPropertyValue(propName);
        });
      }

      return result;
    }, params.propertyNames);
    
    console.log("AAAAAAAAAAAAAAAAAaa : ", computedStyles);
    return {
      code: [`// <internal code to get element styles>`],
      action: async () => {
        return {
          content: [{ type: 'text', text: JSON.stringify(computedStyles) }]
        };
      },
      captureSnapshot: false,
      waitForNetwork: false,
    };
  },
});




export default [
  custom_click_on_available_section,
  custom_browser_click_on_labeled_element,
  custom_get_computed_styles
];
