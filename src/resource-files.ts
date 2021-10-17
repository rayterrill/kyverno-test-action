import * as core from "@actions/core";
import * as glob from "@actions/glob";
import * as io from "@actions/io";
import * as exec from "@actions/exec";
import { readFile, writeFile } from "fs";
import { promisify } from "util";
import { loadAll } from "js-yaml";
import { Resource } from "./types";

export const fetchResources = async function (): Promise<Resource[]> {
  const resourceFiles = core
    .getInput("resource-files", { required: false });
  await io.mkdirP("/tmp/kyverno-test");
  const resourceContents: string[] = [];
  let resources: Resource[] = [];

  const globber = await glob.create(resourceFiles, { followSymbolicLinks: false });
  const files = await globber.glob();
  for await (const file of files) {
    const content = (await promisify(readFile)(file, "utf-8")).toString();
    resourceContents.push(content);
    resources = [...resources, ...parseResource(content)];
  }

  if (resourceFiles && files.length === 0) {
    core.warning(`No files resolved for input: ${resourceFiles}`);
  }

  const chartDir = core.getInput("chart-dir", { required: false });
  const valueFiles = core
    .getInput("value-files", { required: false })
    .split("\n")
    .filter((s) => s);

  if (!resourceFiles && !chartDir) {
    core.setFailed("Either set 'resource-files' or 'chart-dir'!");
    return [];
  }

  if (chartDir) {
    const values = valueFiles.map((f) => ["-f", f]).flat();
    const output = await exec.getExecOutput("helm", ["template", chartDir, ...values], { silent: true });

    if (output.exitCode === 0) {
      resourceContents.push(output.stdout);
      resources = [...resources, ...parseResource(output.stdout)];
    } else {
      core.error(`Helm exited with code ${output.exitCode} and output: ${output.stdout}`);
    }
  }

  if (resources.length === 0) {
    core.setFailed("No resource-files found!");
    return [];
  }

  const joined = resourceContents.join("\n---\n");
  core.debug("Discovered resources to check:");
  core.debug(joined);
  await promisify(writeFile)("/tmp/kyverno-test/resources.yaml", joined);
  return resources;
};

export const parseResource = function (content: string): Resource[] {
  return loadAll(content) as Resource[];
};