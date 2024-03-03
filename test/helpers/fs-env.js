/* eslint-disable no-sync */
'use strict';

const path = require('path').posix;

const TaskParameters = require('../../gulp/common/classes/task-parameters');
const Cache = require('../../gulp/builder/classes/cache');
const Configuration = require('../../gulp/builder/classes/configuration');

const stubFsExtra = require('./stub-fs');
const {
   BUILDER_CONFIG_JSON,
   createConfigFile
} = require('./builder-config');

const getModuleName = fileName => fileName.split('/').shift();

function loadConfig() {
   const config = new Configuration();
   config.loadSync([`--config=${BUILDER_CONFIG_JSON}`]);

   return config;
}

class FsEnv {
   constructor(cwd) {
      this.fs = stubFsExtra(cwd);
   }

   createTaskParameters(builderConfig) {
      this._setBuilderConfig(builderConfig);
      this.config = loadConfig();
      this.cache = new Cache(this.config);

      return new TaskParameters(
         this.config,
         this.cache,
         this.config.localizations.length > 0 && this.config.isReleaseMode
      );
   }

   getModuleInfo(moduleName) {
      return this.config.modules.find(v => v.name === moduleName);
   }

   setModuleMeta(moduleName, metaName, data) {
      const librariesPath = this.joinModuleMeta(moduleName, metaName);
      this.fs.stubFile(librariesPath, data);

      return librariesPath;
   }

   setDirectoryContent(directory, contents) {
      const nDirectory = path.normalize(directory);
      const key = nDirectory.endsWith(path.sep) ? nDirectory : `${nDirectory}${path.sep}`;
      let newContents = contents;

      if (this.fs.files.has(key)) {
         newContents = [
            ...this.fs.files.get(key),
            ...contents
         ];
      }

      newContents.filter((v, i) => i === newContents.indexOf(v));
      newContents.forEach((module) => {
         const filePath = path.join(key, module);

         this.fs.stubDirectory(filePath);
      });

      this.fs.stubDirectory(key, newContents);
   }

   async generateCache(inputFiles, useCurrentCache = false) {
      const cache = useCurrentCache ? this.cache : new Cache(this.config);
      this.config.modules.forEach(moduleInfo => cache.setDefaultStore(moduleInfo));

      await this._generateCacheFiles(inputFiles, cache);

      if (!useCurrentCache) {
         await cache.save(false);
      }
   }

   restore() {
      this.fs.restore();
   }

   joinModuleMeta(moduleName, metaName) {
      return path.join(this.config.outputPath, moduleName, '.builder', metaName);
   }

   joinOutputPath(filePath) {
      return path.join(this.config.rawConfig.output, filePath);
   }

   joinCacheOutputPath(filePath) {
      return path.join(this.config.outputPath, filePath);
   }

   joinCachePath(filePath) {
      return path.join(this.config.rawConfig.cache, filePath);
   }

   _setBuilderConfig(builderConfig) {
      const config = createConfigFile(builderConfig);
      this.fs.stubFile(BUILDER_CONFIG_JSON, config);

      for (const moduleInfo of config.modules) {
         this.fs.stubDirectory(moduleInfo.path);
      }
   }

   async _generateCacheFiles(inputFiles, cache) {
      const promises = inputFiles
         .map((fileName) => {
            const moduleInfo = this.getModuleInfo(getModuleName(fileName));
            const filePath = path.join(moduleInfo.appRoot, fileName);

            if (fileName.endsWith('.ts')) {
               return this._generateOutputWithTsFile(filePath, cache, cache.config, moduleInfo);
            }

            if (fileName.endsWith('.svg')) {
               return this._generateOutputWithSvgFile(filePath, cache, cache.config, moduleInfo);
            }

            return Promise.resolve();
         });

      await Promise.all(promises);
   }

   async _generateOutputWithTsFile(fileName, cache, config, moduleInfo) {
      // FIXME: Достаточно неочевидное поведение:
      //  если для исходного файла был вызван метод isFileChanged, то он попадает в нужное поле в кеше и потом,
      //  если исходный файл удаляется, то также будут удалены и все те файлы, порожденные от исходного.
      await cache.isFileChanged(
         fileName,
         'unspecified file content',
         config.hashByContent,
         new Date(2000).toString(),
         moduleInfo
      );

      FsEnv.generateFilesFromTs(path.relative(moduleInfo.appRoot, fileName))
         .map(v => this.joinCacheOutputPath(v))
         .forEach(outputFile => cache.addOutputFile(fileName, outputFile, moduleInfo));
   }

   async _generateOutputWithSvgFile(fileName, cache, config, moduleInfo) {
      // FIXME: Достаточно неочевидное поведение:
      //  если для исходного файла был вызван метод isFileChanged, то он попадает в нужное поле в кеше и потом,
      //  если исходный файл удаляется, то также будут удалены и все те файлы, порожденные от исходного.
      await cache.isFileChanged(
         fileName,
         'unspecified file content',
         config.hashByContent,
         new Date(2000).toString(),
         moduleInfo
      );

      const relPath = path.relative(moduleInfo.appRoot, fileName);
      const svgOutputFile = this.joinCacheOutputPath(relPath);
      cache.addOutputFile(fileName, svgOutputFile, moduleInfo);

      this.fs.stubFile(svgOutputFile);
      this.fs.stubFile(this.joinOutputPath(relPath));

      const fileNameWoExt = relPath.replace(/\.svg$/, '');
      const packageFileWoExt = fileNameWoExt.split(path.sep).slice(0, -1).join(path.sep);
      const packageFile = `${packageFileWoExt}.svg`;
      const packageOutputFile = this.joinCacheOutputPath(packageFile);
      cache.addOutputFile(
         path.dirname(fileName),
         packageOutputFile,
         moduleInfo
      );

      this.fs.stubFile(packageOutputFile);
      this.fs.stubFile(this.joinOutputPath(packageFile));
   }

   static generateFilesFromTs(fileName) {
      const outputFileWoExt = fileName.replace(/\.(tsx?)$/, '');

      return [
         `${outputFileWoExt}.js`,
         `${outputFileWoExt}.min.js`,
         `${outputFileWoExt}.origin.js`,
         `${outputFileWoExt}.min.origin.js`,
         `${outputFileWoExt}.min.original.js`
      ];
   }
}

module.exports = FsEnv;
