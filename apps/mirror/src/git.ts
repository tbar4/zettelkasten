import simpleGit, { type SimpleGit } from "simple-git";
import { existsSync } from "fs";
import { mkdir } from "fs/promises";

export async function openOrInitRepo(dir: string): Promise<SimpleGit> {
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  const git = simpleGit(dir);
  const isRepo = await git.checkIsRepo().catch(() => false);
  if (!isRepo) {
    await git.init();
    await git.addConfig("user.name", "zk mirror");
    await git.addConfig("user.email", "mirror@zk.local");
  }
  return git;
}

export async function commitAll(
  git: SimpleGit,
  message: string
): Promise<boolean> {
  const status = await git.status();
  if (status.isClean()) return false;
  await git.add(".");
  await git.commit(message);
  return true;
}
