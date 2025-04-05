/**
 * Модуль реализует задачу подготовки окружения перед паковкой скомпилированных ресурсов по PageX файлам.
 *
 * @author Krylov M.A.
 */
'use strict';

const fs = require('fs-extra');

const logger = require('../../../../lib/logger').logger();
const { path } = require('../../../../lib/platform/path');
const FilesRegistry = require('../../../../lib/pagex/registry');
const Collector = require('../../../../lib/pagex/collector');
const Routes = require('../../../../lib/pagex/routes');

async function cleanOutputModule(moduleInfo) {
   const promises = [];

   if (await fs.pathExists(moduleInfo.output)) {
      const contents = await fs.readdir(moduleInfo.output, {
         withFileTypes: true
      });

      for (const dirEntry of contents) {
         if (dirEntry.name === 'config.json') {
            continue;
         }

         if (dirEntry.isDirectory()) {
            promises.push(
               fs.rmdir(path.join(moduleInfo.output, dirEntry.name), {
                  maxRetries: 3,
                  recursive: true
               })
            );
         }
      }
   }

   return Promise.all(promises);
}

function generatePrepareWorkspace(taskParameters, workspace) {
   return async function preparePageXPackerWorkspace() {
      // TODO: подумать, можно ли в этой точке использовать кеш для FilesRegistry.
      workspace.registry = FilesRegistry.create();
      workspace.dependencies = new Collector(new Set(
         taskParameters.config.modules.map(({ name }) => name)
      ));
      workspace.routes = new Routes();
      workspace.cachePath = path.join(
         taskParameters.config.cache,
         'pagex-cache'
      );

      try {
         await fs.mkdir(workspace.cachePath, {
            recursive: true
         });
      } catch (error) {
         logger.debug(`Error creating cache directory for pagex: ${error.message}`);
      }

      for await (const moduleName of ['SabyPageLayoutPackages', 'SabyPageContentPackages']) {
         try {
            // TODO: подумать, можно ли в этой точке не удалять неизмененные файлы.
            const targetModule = taskParameters.config.modules
               .find(moduleInfo => moduleInfo.name === moduleName);

            if (targetModule) {
               await cleanOutputModule(targetModule);
            }
         } catch (error) {
            logger.debug(`Error cleaning ${moduleName} directory: ${error.message}`);
         }
      }
   };
}

module.exports = generatePrepareWorkspace;
