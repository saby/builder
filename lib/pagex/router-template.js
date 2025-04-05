/* eslint-disable spaced-comment,no-undef,prefer-arrow-callback,func-names,strict */
define('/*__ROUTER_MODULE_NAME__*/', function() {
   'use strict';
   const RTL_LOCALES = new Set(/*__RTL_LOCALES__*/);

   const COMMON_LAYOUT_RESOURCES = {/*__COMMON_LAYOUT_RESOURCES__*/};

   const LAYOUTS_RESOURCES = new Map(/*__LAYOUTS_RESOURCES__*/);

   const COMMON_CONTENT_RESOURCES = {/*__COMMON_CONTENT_RESOURCES__*/};

   const CONTENTS_RESOURCES = new Map(/*__CONTENTS_RESOURCES__*/);

   function appendResources(resources, chunk, locale) {
      if (RTL_LOCALES.has(locale)) {
         if (chunk.stylesRtl) {
            Array.prototype.push.apply(resources.styles, chunk.stylesRtl);
         }
      } else if (chunk.styles) {
         Array.prototype.push.apply(resources.styles, chunk.styles);
      }

      if (chunk.locales && chunk.locales[locale]) {
         Array.prototype.push.apply(resources.locales, chunk.locales[locale]);
      }

      if (chunk.scripts) {
         Array.prototype.push.apply(resources.scripts, chunk.scripts);
      }
   }

   function getPageResources(pageId, locale) {
      if (!CONTENTS_RESOURCES.has(pageId)) {
         return null;
      }

      const resources = {
         scripts: [],
         styles: [],
         locales: []
      };

      const page = CONTENTS_RESOURCES.get(pageId);

      appendResources(resources, COMMON_LAYOUT_RESOURCES, locale);

      if (LAYOUTS_RESOURCES.has(page.layout)) {
         const layout = LAYOUTS_RESOURCES.get(page.layout);

         appendResources(resources, layout, locale);
      }

      appendResources(resources, COMMON_CONTENT_RESOURCES, locale);
      appendResources(resources, page, locale);

      return resources.styles.concat(
         resources.locales,
         resources.scripts
      );
   }

   return getPageResources;
});
