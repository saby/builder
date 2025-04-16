/**
 * @author Krylov M.A.
 */
'use strict';

const Generator = require('../../../../lib/pagex/generator');
const { path } = require('../../../../lib/platform/path');
const { writeJsonArtifact } = require('./utils');

function toObject(map) {
   const result = {};

   for (const key of Array.from(map.keys()).sort()) {
      result[key] = map.get(key);
   }

   return result;
}

function generateBuildPackages(taskParameters, workspace) {
   return async function buildPackagesWithPageX() {
      const rootPageComponents = new Map();
      workspace.registry.forEach((id, value) => {
         const component = workspace.routes.getApplicationComponentByPage(id);

         if (component) {
            value.modules.unshift(component);

            rootPageComponents.set(id, {
               modules: [component]
            });
         }
      });

      const generator = new Generator(
         workspace.layouts,
         workspace.registry,
         workspace.dependencies,
         rootPageComponents
      );

      const artifact = generator.build(workspace.config);

      workspace.filesDistribution = artifact.filesDistribution;

      await writeJsonArtifact(
         path.join(workspace.cachePath, 'modules-distribution.json'),
         artifact.modulesDistribution
      );

      await writeJsonArtifact(
         path.join(workspace.cachePath, 'files-distribution.json'),
         artifact.filesDistribution
      );

      await writeJsonArtifact(
         path.join(workspace.cachePath, 'locales.json'),
         workspace.dependencies.locales
      );

      await writeJsonArtifact(
         path.join(workspace.cachePath, 'optionals.json'),
         toObject(workspace.dependencies.optionals)
      );
   };
}

module.exports = generateBuildPackages;
