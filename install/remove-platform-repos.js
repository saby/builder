'use strict';

const path = require('path');
const fs = require('fs-extra');
const nodeModulesPath = path.join(__dirname, '../node_modules');
const { REPOS } = require('../constants');

async function removeReposFromNodeModules() {
   const promises = [];
   Object.keys(REPOS).forEach(currentRepo => promises.push(fs.remove(path.join(nodeModulesPath, currentRepo))));
   await Promise.all(promises);
}

return removeReposFromNodeModules();
