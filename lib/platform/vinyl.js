'use strict';

const Vinyl = require('vinyl');
const { toPosix, toPlatform } = require('./path');

const PATH_PROP_ALIASES = new Map([
   ['pPath', 'path'],
   ['pHistory', 'history'],
   ['pCwd', 'cwd'],
   ['pBase', 'base']
]);

function toVinylProps(file) {
   for (const pathProp in file) {
      if (file.hasOwnProperty(pathProp)) {
         if (PATH_PROP_ALIASES.has(pathProp)) {
            const trueProp = PATH_PROP_ALIASES.get(pathProp);
            const value = file[pathProp];

            file[trueProp] = Array.isArray(value) ? value.map(v => toPlatform(v)) : toPlatform(value);
            delete file[pathProp];
         }
      }
   }

   return file;
}

class PosixVinyl extends Vinyl {
   constructor(file) {
      super(toVinylProps(file));
   }

   clone(opt) {
      return PosixVinyl.from(super.clone(opt));
   }

   get pHistory() {
      return this.history.map(v => toPosix(v));
   }

   set pHistory(history) {
      super.history = history.map(v => toPlatform(v));
   }

   get pCwd() {
      return toPosix(super.cwd);
   }

   set pCwd(cwd) {
      super.cwd = toPlatform(cwd);
   }

   get pBase() {
      return toPosix(super.base);
   }

   set pBase(base) {
      super.base = toPlatform(base);
   }

   get pRelative() {
      return toPosix(super.relative);
   }

   set pRelative(relative) {
      super.relative = toPlatform(relative);
   }

   get pDirname() {
      return toPosix(super.dirname);
   }

   set pDirname(dirname) {
      super.dirname = toPlatform(dirname);
   }

   get pBasename() {
      return toPosix(super.basename);
   }

   set pBasename(basename) {
      super.basename = toPlatform(basename);
   }

   get pStem() {
      return toPosix(super.stem);
   }

   set pStem(stem) {
      super.stem = toPlatform(stem);
   }

   get pExtname() {
      return toPosix(super.extname);
   }

   set pExtname(extname) {
      super.extname = toPlatform(extname);
   }

   get pPath() {
      return toPosix(super.path);
   }

   set pPath(path) {
      super.path = toPlatform(path);
   }

   get pSymlink() {
      return toPosix(super.symlink);
   }

   set pSymlink(symlink) {
      super.symlink = toPlatform(symlink);
   }

   static from(vinyl) {
      if (vinyl instanceof PosixVinyl) {
         return vinyl;
      }

      const proxy = new PosixVinyl({
         cwd: vinyl.cwd,
         base: vinyl.base,
         stat: vinyl.stat || null,
         history: vinyl.history.slice(),
         contents: vinyl.contents
      });

      if (vinyl.isSymbolic()) {
         proxy.symlink = vinyl.symlink;
      }

      Object.keys(vinyl).forEach((key) => {
         if (Vinyl.isCustomProp(key)) {
            proxy[key] = vinyl[key];
         }
      });

      return proxy;
   }
}

module.exports = PosixVinyl;
