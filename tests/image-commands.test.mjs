import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDrawCommand, buildReferenceCommand } from '../src/discord/image-commands.mjs';

test('draw schema preserves existing options and adds optional image/reference/model choices', () => {
  const command = buildDrawCommand().toJSON();
  assert.equal(command.name, 'draw');
  assert.deepEqual(command.options.slice(0, 10).map(option => [option.name, option.type, !!option.required]), [
    ['prompt', 3, true], ['width', 4, false], ['height', 4, false], ['steps', 4, false],
    ['cfg', 10, false], ['sampler', 3, false], ['seed', 4, false], ['batch', 4, false], ['negative', 3, false],
    ['image', 11, false],
  ]);
  assert.deepEqual(command.options.slice(10).map(option => [option.name, option.type, !!option.required]), [
    ['reference', 3, false], ['reference2', 3, false], ['reference3', 3, false], ['reference4', 3, false],
    ['reference5', 3, false], ['reference6', 3, false], ['reference7', 3, false], ['reference8', 3, false], ['model', 3, false],
  ]);
  assert.equal(command.options.length, 19);
  assert.deepEqual(command.options.at(-1).choices.map(choice => choice.value), ['auto', 'flare', 'sunburst']);
});

test('reference schema exposes required and optional fields for all four subcommands', () => {
  const command = buildReferenceCommand().toJSON();
  assert.equal(command.name, 'reference');
  assert.deepEqual(command.options.map(option => option.name), ['add', 'list', 'show', 'delete']);
  assert.deepEqual(command.options[0].options.map(option => [option.name, option.type, !!option.required]), [
    ['name', 3, true], ['image', 11, true], ['image2', 11, false], ['image3', 11, false], ['image4', 11, false], ['replace', 5, false],
  ]);
  for (const subcommand of command.options.slice(2)) assert.equal(subcommand.options[0].required, true);
});
