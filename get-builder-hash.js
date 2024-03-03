/* eslint-disable no-console, id-match */
'use strict';

const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');

/**
 * List of files of builder code that should cause full builder cache reset due to theirs
 * code updates
 * @type {string[]}
 */
const FILES_FOR_BUILDER_HASH = [
   '/less/',
   '/pack/',
   '/templates/',
   '/espree/',
   '/es-converter/',
   '/changed-files/',
   '/platform',
   'gulp/builder/',
   'gulp/common/',
   'compile-less.js',
   'build-tmpl.js',
   'build-xhtml.js',
   'modules-cache.js',
   'cache.js',
   'custom-packer.js',
   'configuration.js',
   'remove-outdated-files.js',
   'versionize-content.js',
   'builderVersion'
];

async function recursiveGetAllBuilderFiles(dir) {
   // dirent is a directory entry, it has all needed information about itself
   const dirents = await fs.readdir(dir, { withFileTypes: true });
   const files = await Promise.all(dirents
      .filter(dirent => !['node_modules', '.git'].includes(dirent.name))
      .map((dirent) => {
         const res = path.resolve(dir, dirent.name);
         return dirent.isDirectory() ? recursiveGetAllBuilderFiles(res) : res;
      }));
   return files.flat();
}

async function getBuilderCodeHash(filesList) {
   const filesContent = await Promise.all(
      filesList
         .filter((currentFile) => {
            const prettyPath = currentFile.replace(/\\/g, '/');
            let isNeeded = false;
            FILES_FOR_BUILDER_HASH.forEach((mask) => {
               if (prettyPath.includes(mask)) {
                  isNeeded = true;
               }
            });
            return isNeeded;
         })
         .map(currentFile => fs.readFile(currentFile, 'utf8'))
   );
   return crypto
      .createHash('sha1')
      .update(filesContent.join('\n'))
      .digest('base64');
}

async function getBuilderHash() {
   const builderDirectory = __dirname;
   console.log(`Generating builder hash. Current working directory is: "${builderDirectory}"`);
   const filesList = await recursiveGetAllBuilderFiles(builderDirectory);
   const builderHash = await getBuilderCodeHash(filesList);
   await fs.writeFile(path.join(builderDirectory, 'builderHashFile'), builderHash);
}
return getBuilderHash();
