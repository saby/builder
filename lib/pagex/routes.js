/**
 * @author Krylov M.A.
 */
'use strict';

const DEFAULT_ROUTE = 'page';

function getComponent(componentReference) {
   return `${componentReference.split('/').shift()}/Index`;
}

function cleanUrlString(str) {
   return str
      .replace(/^\/*/, '');
}

function cleanReferenceString(str) {
   return str
      .replace(/^\/*/, '')
      .replace(/\/*$/, '');
}

function getPageId(componentReference) {
   const re = /\/page\/([^/]+)$/;

   if (re.test(componentReference)) {
      return re.exec(componentReference)[1];
   }

   return null;
}

class Routes {
   constructor() {
      this.pages = new Map();
      this.routes = new Map();
      this.ambiguousUrls = new Map();
   }

   getComponents() {
      const components = new Set();

      this.pages.forEach((component) => {
         components.add(component);
      });

      return Array.from(components);
   }

   addRoutesFile(filePath, contents) {
      for (const rawUrl in contents) {
         if (contents.hasOwnProperty(rawUrl)) {
            this._addRoute(filePath, rawUrl, contents[rawUrl]);
         }
      }
   }

   getApplicationComponentByPage(pageId) {
      if (this.pages.has(pageId)) {
         return this.pages.get(pageId);
      }

      if (this.routes.has(DEFAULT_ROUTE)) {
         return this.routes.get(DEFAULT_ROUTE).component;
      }

      return null;
   }

   _addRoute(filePath, rawUrl, rawReference) {
      const url = cleanUrlString(rawUrl);
      const ref = cleanReferenceString(rawReference);

      const elementOrigin = {
         filePath,
         url: rawUrl,
         ref: rawReference
      };

      const routerElement = {
         ref,
         pageId: getPageId(ref),
         component: getComponent(ref),
         origin: [elementOrigin]
      };

      if (this.ambiguousUrls.has(url)) {
         this.ambiguousUrls.get(url).push(routerElement);

         return;
      }

      if (this.routes.has(url)) {
         const ambiguousRouterElement = this.routes.get(url);

         const isDuplicate = (
            ambiguousRouterElement.ref === routerElement.ref &&
            ambiguousRouterElement.pageId === routerElement.pageId &&
            ambiguousRouterElement.component === routerElement.component
         );

         if (isDuplicate) {
            ambiguousRouterElement.origin.push(elementOrigin);

            return;
         }

         this.ambiguousUrls.set(url, [ambiguousRouterElement, routerElement]);

         this.routes.delete(url);
         this.pages.delete(ambiguousRouterElement.pageId);

         return;
      }

      this.routes.set(url, routerElement);

      if (routerElement.pageId) {
         this.pages.set(routerElement.pageId, routerElement.component);
      }
   }
}

module.exports = Routes;
