/**
 * @author Krylov M.A.
 */
'use strict';

const fs = require('fs-extra');
const { path } = require('../platform/path');

async function generateRouterContent(moduleName, rtlLocales, layouts, contents) {
   const sourceText = await fs.readFile(
      path.join(__dirname, 'router-template.js'),
      'utf-8'
   );

   return sourceText
      .replace(/\/\*__ROUTER_MODULE_NAME__\*\//, moduleName)
      .replace(/\/\*__RTL_LOCALES__\*\//, JSON.stringify(rtlLocales))
      .replace(/{\/\*__COMMON_LAYOUT_RESOURCES__\*\/}/, JSON.stringify(layouts.common))
      .replace(/\/\*__LAYOUTS_RESOURCES__\*\//, JSON.stringify(Array.from(layouts.packages)))
      .replace(/{\/\*__COMMON_CONTENT_RESOURCES__\*\/}/, JSON.stringify(contents.common))
      .replace(/\/\*__CONTENTS_RESOURCES__\*\//, JSON.stringify(Array.from(contents.packages)));
}

module.exports = generateRouterContent;
