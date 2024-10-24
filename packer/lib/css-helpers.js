'use strict';

const { path, toSafePosix } = require('../../lib/platform/path');
const postcss = require('postcss');
const postcssUrl = require('postcss-url');
const safe = require('postcss-safe-parser');
const logger = require('../../lib/logger').logger();
const invalidUrl = /^(\/|#|data:|[a-z]+:\/\/)(?=.*)/i;

function rebaseUrlsToAbsolutePath(cssConfig) {
   const {
      root,
      sourceFile,
      css,
      relativePackagePath,
      resourcesUrl
   } = cssConfig;
   let result;

   const rootForRebase = path.join(root, relativePackagePath);
   try {
      result = postcss()
         .use(
            postcssUrl({
               url(asset, dir) {
                  // ignore absolute urls, hashes or data uris
                  if (invalidUrl.test(asset.url)) {
                     return asset.url;
                  }

                  /**
                   * path to style can be joined in 2 different ways:
                   * 1) for local demo-examples(f.e. controls) - site root + relative link by site root
                   * 2) for ordinary stand - site root + resources + relative link by site root
                   * A normalized relative path will be returned according to these facts.
                   */
                  return `${resourcesUrl || ''}${toSafePosix(
                     path.relative(
                        dir.to,
                        path.join(dir.from, asset.url)
                     )
                  )}`;
               }
            })
         )
         .process(css, {
            parser: safe,
            from: sourceFile,
            to: rootForRebase
         }).css;
   } catch (e) {
      logger.warning({
         message: 'Failed to parse CSS file.',
         filePath: sourceFile,
         error: e
      });
      result = '';
   }

   return result;
}

function rebaseCdnRootUrls(css, multiService) {
   try {
      return postcss()
         .use(
            postcssUrl({
               url(asset) {
                  // ignore absolute urls, hashes or data uris
                  if (asset.url.includes('%{CDN_ROOT}')) {
                     const cdnRootIndex = asset.url.indexOf('%{CDN_ROOT}');
                     const normalizedLink = asset.url.replace(asset.url.slice(0, cdnRootIndex), '');

                     // урлы с %{CDN_ROOT} возвращаем только для мульти-сервисных приложений, в них
                     // заменой плейсхолдеров занимается jinnee, для всех single service приложений
                     // возвращаем /cdn/ по дефолту
                     if (multiService) {
                        return normalizedLink;
                     }
                     return normalizedLink.replace('%{CDN_ROOT}', '/cdn/');
                  }

                  return asset.url;
               }
            })
         )
         .process(css, {
            parser: safe
         }).css;
   } catch (error) {
      throw new Error(`Error during processing %{CDN_ROOT} urls in compiled css file: ${error.message} \n Stack: ${error.stack}`);
   }
}

module.exports = {
   rebaseUrls: rebaseUrlsToAbsolutePath,
   rebaseCdnRootUrls
};
