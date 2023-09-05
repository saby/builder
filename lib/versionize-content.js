/**
 * Set of functions for version-conjunction into static content
 * @author Kolbeshin F.A.
 */
'use strict';
const versionHeader = 'x_module=%{MODULE_VERSION_STUB=%{modulePlaceholder}}';
const { path, toPosix, removeLeadingSlashes } = require('./platform/path');
const logger = require('./logger').logger();
const transliterate = require('./transliterate');
const pMap = require('p-map');
const fs = require('fs-extra');
const http = require('http');

/**
 * placeholders examples:
 * 1) %{RESOURCE_ROOT}, %{WI.SBIS_ROOT} - from html.tmpl and templates for routing
 * 2) {{_options.resourceRoot}}, {{resourceRoot}} - from tmpl, xhtml.
 */
const templatePlaceholders = /^(\/?%?{?{[\w. =]+}}?\/?)/;

const resourcesLink = /^[^/]*\/?resources\//;

const metaRootLink = '%{APPLICATION_ROOT}resources/';

/**
 * get correct module name for template's url
 * @param linkPath - current link
 * @returns {string|*}
 */
function getTemplateLinkModuleName(content, linkPath, prettyFilePath, fileBase) {
   let normalizedLink = removeLeadingSlashes(linkPath);

   if (normalizedLink.startsWith('../') || normalizedLink.startsWith('./')) {
      const root = path.dirname(fileBase);
      const resolvedPath = path.resolve(
         path.dirname(prettyFilePath),
         linkPath
      );
      const pathWithoutRoot = removeLeadingSlashes(resolvedPath.replace(root, ''));
      return pathWithoutRoot.split('/').shift();
   }

   // get correct module name for previewer links in templates
   if (normalizedLink.startsWith('previewer')) {
      const noResourcesLinkParts = normalizedLink.replace(/previewer\/?.*?\/resources\//, '').split('/');
      return noResourcesLinkParts.length > 1 ? noResourcesLinkParts.shift() : '';
   }

   // get correct module name for links with meta root
   if (normalizedLink.startsWith(metaRootLink)) {
      const noResourcesLinkParts = normalizedLink.replace(metaRootLink, '').split('/');
      return noResourcesLinkParts.length > 1 ? noResourcesLinkParts.shift() : '';
   }

   // for wsRoot and WI.SBIS_ROOT placeholders we should set moduleName as 'WS.Core'
   if (normalizedLink.includes('wsRoot') || normalizedLink.includes('WI.SBIS_ROOT')) {
      return 'WS.Core';
   }
   if (templatePlaceholders.test(normalizedLink)) {
      normalizedLink = normalizedLink.replace(templatePlaceholders, '');
      const normalizedLinkParts = normalizedLink.split('/');
      return normalizedLinkParts.length > 1 ? normalizedLinkParts.shift() : '';
   }
   if (resourcesLink.test(normalizedLink)) {
      const noResourcesLinkParts = normalizedLink.replace(resourcesLink, '').split('/');
      return noResourcesLinkParts.length > 1 ? noResourcesLinkParts.shift() : '';
   }

   const rootConcatenation = new RegExp(`((resourceroot)|(wsroot))[ ]+\\+[ ]+['"]${linkPath}`, 'i');
   if (rootConcatenation.test(content)) {
      const linkParts = normalizedLink.split('/');
      return linkParts.length > 1 ? linkParts.shift() : '';
   }

   // all remaining links are relative by current file path
   return '';
}

/**
 * Requests current font url from selected server
 * @param {Object} options options with domain name and url address to request
 * @returns {Promise<unknown>}
 */
function requestUrlContent(options) {
   return new Promise((resolve, reject) => {
      const chunks = [];
      const request = http.request(options, (res) => {
         res.on('data', (chunk) => {
            chunks.push(chunk);
         });
         res.on('end', () => {
            if (res.statusCode === 404) {
               reject(new Error(`font with url ${options.path} Not Found!`));
            } else {
               resolve(Buffer.concat(chunks));
            }
         });
      });
      request.on('error', (error) => {
         reject(error.message);
      });
      request.end();
   });
}

/**
 * Gets font type to generate proper css style for font in base64 format
 * @param {String} filePath full path of font
 * @returns {string}
 */
function getFontType(filePath) {
   switch (path.extname(filePath)) {
      case '.woff':
      case '.ttf':
         return 'application/font-woff';
      case '.woff2':
         return 'application/font-woff2';
      case '.eot':
         return 'application/vnd.ms-fontobject';
      default:
         return '';
   }
}

/**
 * Converts current font to base64 by current local file path
 * @param {String} filePath full file path
 * @returns {string}
 */
function getFontBase64ByFile(filePath) {
   try {
      const fontData = fs.readFileSync(filePath);
      return `data:${getFontType(filePath)};charset=utf-8;base64,${fontData.toString('base64')}`;
   } catch (error) {
      logger.info(`Could not process ${filePath} font. Error: ${error.message} Stack: ${error.stack}`);
   }
   return '';
}

/**
 * Converts current font to base64 by current remote font url(cdn fonts)
 * @param {String} urlPath full file path
 * @returns {string}
 */
async function getFontBase64ByUrl(urlPath) {
   try {
      const options = {
         host: 'pre-test-cdn.sbis.ru',
         path: urlPath
      };
      const fetchData = await requestUrlContent(options);

      return `data:${getFontType(urlPath)};charset=utf-8;base64,${fetchData.toString('base64')}`;
   } catch (error) {
      logger.info(`Could not process ${urlPath} font. Error: ${error.message} Stack: ${error.stack}`);
   }
   return '';
}

/**
 * get correct module name for style's links
 * @param prettyFilePath - current file path
 * @param linkPath - current link
 * @param fileBase - current file module path
 * @returns {*}
 */
function getStyleLinkModuleName(prettyFilePath, linkPath, fileBase) {
   const moduleName = path.basename(fileBase);
   const root = path.dirname(fileBase);
   if (linkPath.startsWith('../') || linkPath.startsWith('./')) {
      const resolvedPath = path.resolve(
         path.dirname(prettyFilePath),
         linkPath
      );
      const pathWithoutRoot = removeLeadingSlashes(resolvedPath.replace(root, ''));
      return pathWithoutRoot.split('/').shift();
   }

   // css styles also could have same placeholders as templates
   // e.g. url(%{RESOURCE_ROOT}MyModule/images/myImage.svg)
   if (templatePlaceholders.test(linkPath)) {
      const normalizedLink = linkPath.replace(templatePlaceholders, '');
      const normalizedLinkParts = normalizedLink.split('/');
      return normalizedLinkParts.length > 1 ? normalizedLinkParts.shift() : '';
   }

   // transliterate resolved module to avoid difference in output name and source name
   return transliterate(moduleName);
}

function checkModuleInDependencies(link, versionModuleName, currentModuleName, moduleInfo) {
   if (versionModuleName !== currentModuleName && !moduleInfo.depends.includes(versionModuleName)) {
      let message;

      /**
       * bad relative link will be resolved to this module name:
       * 1)"home" for nix executors
       * 2)name with ":" - part of hard drive name on windows
       */
      if (versionModuleName === 'home' || versionModuleName.includes(':')) {
         message = `bad relative link ${link}. Check workspace you're linking to. Resolved to: ${versionModuleName}`;
      } else {
         message = `External Interface module "${versionModuleName}" usage in link: ${link} ` +
            `Check for this interface module in dependencies list of module "${currentModuleName}" (.s3mod file).` +
            ` Current dependencies list: [${moduleInfo.depends}]`;
      }

      // "themes" is a folder containing artifacts of themes join and it would be
      // created dynamically by jinnee in project deploy, so external check is
      // useless here
      if (versionModuleName === 'themes' || versionModuleName === 'ThemesModule') {
         return {
            error: false
         };
      }

      return {
         error: true,
         message
      };
   }
   return {};
}

/**
 * Fulfill fonts data first and then replace
 * them in same order that they were read from
 * current style to assure fonts order replacement.
 * @param newText
 * @param fontsArray
 * @returns {Promise<*>}
 */
async function processCdnFonts(newText, fontsArray) {
   let resultText = newText;
   const cdnData = {};

   // for cdn fonts in _ie.css files do replace url
   // with converted base64 format of font
   await pMap(
      fontsArray,
      async(currentCDNFont) => {
         const currentFontData = await getFontBase64ByUrl(currentCDNFont);
         if (currentFontData) {
            cdnData[currentCDNFont] = currentFontData;
         }
      }
   );

   fontsArray.forEach((currentFont) => {
      if (cdnData[currentFont]) {
         resultText = resultText.replace(currentFont, cdnData[currentFont]);
      }
   });

   return resultText;
}

async function versionizeStyles(file, moduleInfo, skipLogs) {
   const content = file.contents.toString();
   const currentModuleName = path.basename(moduleInfo.output);
   let errors = false;
   const externalDependencies = new Set([]);
   const cdnFonts = [];
   let newText = content.replace(
      /(url\(['"]?)([\w/.\-@%{}]+)(\.svg|\.gif|\.png|\.jpg|\.jpeg|\.css|\.woff2?|\.eot|\.ttf)(\?[\w#]+)?/g,
      (match, partUrl, partFilePath, partExt, extraData) => {
         // ignore cdn
         if (partFilePath.indexOf('cdn/') > -1) {
            if (
               ['.woff', '.woff2', '.eot', '.ttf'].includes(partExt) &&
               file.pPath.endsWith('_ie.css')
            ) {
               cdnFonts.push(`${partFilePath}${partExt}`);
            }
            return match;
         }
         if (partFilePath.indexOf('%{CDN_ROOT}') > -1) {
            file.cdnLinked = true;
            return match;
         }

         file.versioned = true;
         const versionModuleName = getStyleLinkModuleName(
            toPosix(file.path),
            toPosix(partFilePath),
            toPosix(file.base)
         );

         /**
          * WS.Core is dependent on some platform modules depending on WS.Core.
          * Therefore we can ignore this module and prevent cycle dependency issues.
          * Patches technology is not supposed to be used in control's integration tests,
          * so we can also ignore "Intest" interface module in external dependencies checker.
          */
         let checkResult = {};

         if (moduleInfo.name !== 'WS.Core' && moduleInfo.name !== 'Intest') {
            checkResult = checkModuleInDependencies(
               partFilePath,
               versionModuleName,
               currentModuleName,
               moduleInfo
            );

            // dont log errors for urls not existing in source less files
            if (checkResult.error && (!file.lessSource || file.lessSource.includes(partFilePath))) {
               errors = true;
               if (!skipLogs) {
                  logger.error({
                     filePath: file.path,
                     moduleInfo,
                     message: checkResult.message
                  });
               }
            }
         }

         if (
            versionModuleName &&
            versionModuleName !== currentModuleName &&
            !checkResult.error
         ) {
            externalDependencies.add(versionModuleName);
         }

         const currentVersionHeader = versionHeader.replace('%{modulePlaceholder}', versionModuleName);
         let result = `${partUrl}${partFilePath}${partExt}`;

         // for fonts in _ie.css files do replace url
         // with converted base64 format of font
         if (
            ['.woff', '.woff2', '.eot', '.ttf'].includes(partExt) &&
            file.pPath.endsWith('_ie.css')
         ) {
            const filePath = path.resolve(path.join(moduleInfo.path, file.relative), '..', `${partFilePath}${partExt}`);
            const currentFontData = getFontBase64ByFile(filePath);
            if (currentFontData) {
               return `${partUrl}${currentFontData}`;
            }
         }

         if (extraData) {
            const remainingHeaders = extraData.slice(1, extraData.length);
            result += `?${currentVersionHeader}`;
            result += `${remainingHeaders.startsWith('#') ? '' : '#'}${remainingHeaders}`;
         } else {
            result += `?${currentVersionHeader}`;
         }

         return result;
      }
   );

   newText = await processCdnFonts(newText, cdnFonts);

   return {
      externalDependencies,
      errors,
      newText
   };
}

function versionizeTemplates(file, moduleInfo, skipLogs) {
   const content = file.contents.toString();
   const currentModuleName = path.basename(moduleInfo.output);
   let errors = false;
   const externalDependencies = new Set([]);
   const newText = content
      .replace(
         /((?:"|')(?:[A-z]+(?!:\/)|\/|\.\/|%[^}]+}|{{[^{}]+}})[\w{}/+-.]*(?:\.\d+)?(?:{{[^{}]+}})?)(\.svg|\.css|\.gif|\.png|\.jpg|\.jpeg|\.woff2?|\.eot|\.ttf|\.ico)(\?|"|')/gi,
         (match, partFilePath, partExt, remainingPart) => {
            // ignore cdn
            if (partFilePath.indexOf('cdn/') > -1) {
               return match;
            }
            if (partFilePath.indexOf('%{CDN_ROOT}') > -1) {
               file.cdnLinked = true;
               return match;
            }

            let versionModuleName = getTemplateLinkModuleName(
               content,
               partFilePath.replace(/^("|')/, ''),
               toPosix(file.path),
               toPosix(file.base)
            );

            if (!versionModuleName) {
               versionModuleName = path.basename(moduleInfo.output);
            }

            /**
             * WS.Core is dependent on some platform modules depending on WS.Core.
             * Therefore we can ignore this module and prevent cycle dependency issues.
             * Patches technology is not supposed to be used in control's integration tests,
             * so we can also ignore "Intest" interface module in external dependencies checker.
             */
            let checkResult = {};

            if (moduleInfo.name !== 'WS.Core' && moduleInfo.name !== 'Intest') {
               checkResult = checkModuleInDependencies(
                  partFilePath,
                  versionModuleName,
                  currentModuleName,
                  moduleInfo
               );

               if (checkResult.error) {
                  errors = true;
                  if (!skipLogs) {
                     logger.error({
                        filePath: file.path,
                        moduleInfo,
                        message: checkResult.message
                     });
                  }
               }
            }

            if (
               versionModuleName &&
               versionModuleName !== currentModuleName &&
               !checkResult.error
            ) {
               externalDependencies.add(versionModuleName);
            }

            const currentVersionHeader = versionHeader.replace('%{modulePlaceholder}', versionModuleName);
            file.versioned = true;

            if (partExt === '.css') {
               // There isn't need of duplicate of min extension if it's already exists in current URL
               const partFilePathWithoutMin = partFilePath.replace(/\.min$/, '');
               return `${partFilePathWithoutMin}.min${partExt}?${currentVersionHeader}${remainingPart}`;
            }

            return `${partFilePath}${partExt}?${currentVersionHeader}${remainingPart}`;
         }
      )
      .replace(
         /([\w]+[\s]*=[\s]*)((?:"|')(?:[A-z]+(?!:\/)|\/|(?:\.|\.\.)\/|%[^}]+}|{{[^{}]*}})[\w/+-.]+(?:\.\d+)?)(\.js)/gi,
         (match, partEqual, partFilePath, partExt) => {
            // ignore cdn and data-providers
            if (partFilePath.indexOf('%{CDN_ROOT}') > -1) {
               file.cdnLinked = true;
               return match;
            }

            if (
               partFilePath.indexOf('cdn/') > -1 ||
               partFilePath.indexOf('//') === 1 ||
               !/^src|^href/i.test(match) ||
               partFilePath.indexOf('?x_module=') > -1
            ) {
               return match;
            }

            file.versioned = true;
            const versionModuleName = getTemplateLinkModuleName(
               content,
               partFilePath.replace(/^("|')/, ''),
               toPosix(file.path),
               toPosix(file.base)
            );

            /**
             * WS.Core is dependent on some platform modules depending on WS.Core.
             * Therefore we can ignore this module and prevent cycle dependency issues.
             * Patches technology is not supposed to be used in control's integration tests,
             * so we can also ignore "Intest" interface module in external dependencies checker.
             */
            let checkResult = {};

            if (moduleInfo.name !== 'WS.Core' && moduleInfo.name !== 'Intest') {
               checkResult = checkModuleInDependencies(
                  partFilePath,
                  versionModuleName || path.basename(moduleInfo.output),
                  currentModuleName,
                  moduleInfo
               );

               if (checkResult.error) {
                  errors = true;
                  logger.error({
                     filePath: file.path,
                     moduleInfo,
                     message: checkResult.message
                  });
               }
            }

            if (
               versionModuleName &&
               versionModuleName !== currentModuleName
            ) {
               externalDependencies.add(versionModuleName);
            }

            // There isn't need of duplicate of min extension if it's already exists in current URL
            const partFilePathWithoutMin = partFilePath.replace(/\.min$/, '');
            let currentVersionHeader;

            /**
             * In case of we have URL with specific interface module, paste placeholder
             * for further replacing of it with the interface module version by jinnee-utility.
             * Otherwise add last actual build number(needed especially by root URLs, such as
             * contents/bundles/router).
             */
            if (versionModuleName) {
               currentVersionHeader = versionHeader.replace(
                  '%{modulePlaceholder}',
                  versionModuleName
               );
            }

            return `${partEqual}${partFilePathWithoutMin}.min${partExt}${currentVersionHeader ? `?${currentVersionHeader}` : ''}`;
         }
      );
   return {
      externalDependencies,
      errors,
      newText
   };
}

module.exports = {
   versionizeStyles,
   versionizeTemplates
};
