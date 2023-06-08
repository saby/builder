'use strict';

const fs = require('fs-extra');
const { path, cwd } = require('../../../../lib/platform/path');
const createConfig = require('./configuration');

async function getTypescriptDirectory() {
   if (await fs.pathExists(path.join(cwd(), '../saby-typescript'))) {
      return path.join(cwd(), '../saby-typescript');
   }

   return path.join(cwd(), 'node_modules/saby-typescript');
}

function xor(a, b) {
   return (!a && b) || (a && !b);
}

async function removeDropCache(taskParameters) {
   if (!taskParameters.config.tscCache) {
      return;
   }

   // В случае, если кеш-файл существует, а output директории нет,
   // необходимо удалить кеш-файл
   const cacheExists = await fs.pathExists(taskParameters.config.tscCachePath);
   const outputExists = await fs.pathExists(taskParameters.typescriptOutputDir);

   if (xor(cacheExists, outputExists)) {
      await fs.promises.rm(taskParameters.config.tscCachePath, { force: true, recursive: true });
      await fs.promises.rm(taskParameters.typescriptOutputDir, { force: true, recursive: true });
   }
}

function prepare(taskParameters) {
   return async function prepareTypescriptWorkspace() {
      taskParameters.sabyTypescriptDir = await getTypescriptDirectory();
      taskParameters.typescriptOutputDir = path.join(
         path.dirname(taskParameters.config.tscCachePath),
         'emit'
      );
      taskParameters.typescriptConfigPath = path.join(
         taskParameters.config.sourcesDirectory,
         'tsconfig.json'
      );

      await removeDropCache(taskParameters);

      const config = createConfig(taskParameters);

      await fs.outputFile(
         taskParameters.typescriptConfigPath,
         JSON.stringify(config, null, 3)
      );

      await fs.ensureSymlink(
         path.join(taskParameters.sabyTypescriptDir, 'tslib.d.ts'),
         path.join(taskParameters.config.sourcesDirectory, 'tslib.d.ts')
      );

      /**
       * symlink also node_modules from builder to current project.
       * tsconfig requires types definition module(node_modules/@types) to be defined in current project node_modules.
       */
      await fs.ensureSymlink(
         path.dirname(taskParameters.sabyTypescriptDir),
         path.join(taskParameters.config.sourcesDirectory, 'node_modules')
      );
   };
}

function clean(taskParameters) {
   return async function cleanTypescriptWorkspace() {
      await fs.unlink(path.join(taskParameters.config.sourcesDirectory, 'tslib.d.ts'));
      await fs.unlink(path.join(taskParameters.config.sourcesDirectory, 'node_modules'));

      delete taskParameters.sabyTypescriptDir;
   };
}

module.exports = {
   prepare,
   clean
};
