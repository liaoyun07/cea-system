import fs from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const generated = file => fs.readFileSync(new URL('../../../.idea/runConfigurations/' + file, import.meta.url), 'utf8');
test('backend compiles before the finite local-switch prerequisite; prerequisite has no recursive hook', () => {
  const backend = generated('CEA_Backend_Local.xml');
  assert.ok(backend.indexOf('name="Make"') < backend.indexOf('name="RunConfigurationTask"'));
  assert.match(backend, /run_configuration_name="CEA - Prepare Local" run_configuration_type="js.build_tools.npm"/);
  const prepare = generated('CEA_Prepare_Local.xml');
  assert.match(prepare, /name="CEA - Prepare Local" type="js.build_tools.npm"/);
  assert.match(prepare, /<script value="prepare:local"/);
  assert.doesNotMatch(prepare, /RunConfigurationTask/);
});
test('one-click compound launches frontend and backend, not a duplicate switching process', () => {
  const compound = generated('CEA_Run_All.xml');
  assert.match(compound, /type="CompoundRunConfigurationType"/);
  assert.equal((compound.match(/<toRun /g) || []).length, 2);
  assert.match(compound, /<toRun name="CEA Backend - Local" type="SpringBootApplicationConfigurationType"/);
  assert.match(compound, /<toRun name="CEA Frontend - Local" type="js.build_tools.npm"/);
});
test('restore button and finite preparation map to the existing tested switch commands', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.scripts['prepare:local'], 'node switch.mjs local');
  assert.equal(pkg.scripts['restore:docker'], 'node switch.mjs docker');
  assert.match(generated('CEA_Restore_Docker.xml'), /<script value="restore:docker"/);
});
