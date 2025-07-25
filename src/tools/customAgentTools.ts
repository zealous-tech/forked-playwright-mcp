import { z } from 'zod';
import { defineTool, defineTabTool } from './tool.js';
import { generateLocator } from './utils.js';
import type * as playwright from 'playwright';

/**
 * Get the title of the current page.
 */
// export const custom_click_on_available_section = defineTabTool({
//   capability: 'core',
//   schema: {
//     name: 'custom_click_on_available_section',
//     title: 'Click on Available Section',
//     description: 'Finds and clicks on available section',
//     inputSchema: z.object({}),
//     type: 'destructive',
//   },

//   handle: async (tab, params, response) => {
//     response.setIncludeSnapshot();
//     const page = tab.page
//     // Use locator() instead of querySelector()
//     const mapElement = page.locator('.seatmap-viewer');
//     // Use getAttribute() on the ElementHandle, not directly on locator


//         await tab.waitForCompletion(async () => {

//           const mapId = await mapElement.getAttribute('data-viewerid');

//           // Extract the function that will be evaluated
//           const getMapItemsFunction = (mapId: string) => {
//             // Add null check before using mapId
//             if (!mapId) {
//               throw new Error("Could not find data-viewerid attribute on seatmap-viewer element");
//             }
//             const map = (window as any).DvmViewers[mapId];
//             const nodes = map.getNodesByType("section").filter((item: { [x: string]: string; }) =>
//               item["state"] === "available" && item["tag"] === "none"
//             );
//             const nodeId = nodes[0].id;

//             const mapCoordinates = map.getContainer().getBoundingClientRect();
//             const nodeCoordinates = map.getNodeById(nodeId).getBoundingClientRect();

//             const x = nodeCoordinates["x"] - mapCoordinates["x"] + nodeCoordinates["width"] / 2;
//             const y = nodeCoordinates["y"] - mapCoordinates["y"] + nodeCoordinates["height"] / 2;

//             return { x, y, nodeId };
//           };

//           const items = await page._evaluateFunction(getMapItemsFunction, mapId);

//           const xCoord = Math.floor(items.x);
//           const yCoord = Math.floor(items.y);

//           // Click at the calculated coordinates
//           const selector = ".seatmap-viewer .d2m-map-layer";
//           const element = page.locator(selector);
//           await element.click({ position: { x: xCoord, y: yCoord } });
//           response.addCode("// Clicks on Available Section")
//           response.addResult(items.nodeId)
//      });
//   },
// });




const elementStyleSchema = z.object({
  element: z.string().describe('Human-readable element description used to obtain permission to interact with the element'),
  ref: z.string().describe('Exact target element reference from the page snapshot'),
  propertyNames: z.array(z.string()).optional().describe('Specific CSS property names to retrieve. If not provided, all computed styles will be returned'),
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
    response.setIncludeSnapshot();

    const { ref, element } = elementStyleSchema.parse(params);
    const result = { ref, element };

    let locator: playwright.Locator | undefined;
    locator = await tab.refLocator(result);
    const code = [
      `// Get computed styles for ${params.element}`,
    ];

    console.log("****************AAAAAAAAAAAAAAAAAAa : ", locator)

    await tab.waitForCompletion(async () => {
      // const receiver = locator ?? tab.page as any;
      // Create the function that will be evaluated
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
      response.addCode(`// <internal code to get element styles>`)
      const computedStyles = await locator._evaluateFunction(getStylesFunction, params.propertyNames);
      response.addResult(JSON.stringify(computedStyles, null, 2) || 'Coudln\'t get requested styles');
    });
  },
});




export default [
  // custom_click_on_available_section,
  get_computed_styles
];
