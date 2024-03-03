'use strict';

const fs = require('fs-extra');
const path = require('path');
const packageObj = require('../package.json');

async function copyToDest() {
   const dest = path.join(__dirname, '../', 'dest');
   if (await fs.pathExists(dest)) {
      await fs.remove(dest);
   }
   await fs.ensureDir(dest);
   const filesToCopy = process.argv.includes('--node_modules=true') ? [...packageObj.files, 'node_modules'] : packageObj.files;

   /**
    * use "files" option from package.json for copying of files to be as standard
    * as it can be and to have a proper work of no-unpublished-require checking
    */
   await Promise.all(
      filesToCopy.map(
         fileOrDir => fs.copy(path.join(__dirname, '../', fileOrDir), path.join(dest, fileOrDir))
      )
   );

   // package-lock.json is needed by npm ci. It's safer and faster than npm i.
   await Promise.all(['package.json', 'package-lock.json'].map(async(packageJsonName) => {
      const srcPathPackageJson = path.join(__dirname, '../', packageJsonName);
      const destPathPackageJson = path.join(dest, packageJsonName);
      let textPackageJson = await fs.readFile(srcPathPackageJson, 'utf8');
      if (process.env.hasOwnProperty('BUILD_NUMBER')) {
         textPackageJson = textPackageJson.replace('BUILD', process.env.BUILD_NUMBER);
      }
      await fs.writeFile(destPathPackageJson, textPackageJson);
   }));

   return null;
}

return copyToDest();
