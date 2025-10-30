import { getUncachableGitHubClient } from '../server/github.js';
import { readdir, readFile, stat } from 'fs/promises';
import { join, relative } from 'path';

const IGNORE_PATTERNS = [
  'node_modules',
  '.git',
  'dist',
  'build',
  '*.log',
  '.DS_Store',
  'project-backup.tar.gz'
];

function shouldIgnore(path: string): boolean {
  return IGNORE_PATTERNS.some(pattern => {
    if (pattern.includes('*')) {
      const regex = new RegExp(pattern.replace('*', '.*'));
      return regex.test(path);
    }
    return path.includes(pattern);
  });
}

async function getAllFiles(dir: string, baseDir: string = dir): Promise<Array<{path: string, content: string}>> {
  const files: Array<{path: string, content: string}> = [];
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    const relativePath = relative(baseDir, fullPath);

    if (shouldIgnore(relativePath)) {
      continue;
    }

    if (entry.isDirectory()) {
      const subFiles = await getAllFiles(fullPath, baseDir);
      files.push(...subFiles);
    } else {
      try {
        const content = await readFile(fullPath, 'utf-8');
        files.push({ path: relativePath, content });
      } catch (err) {
        console.log(`Skipping binary file: ${relativePath}`);
      }
    }
  }

  return files;
}

async function main() {
  try {
    console.log('🔗 Connecting to GitHub...');
    const octokit = await getUncachableGitHubClient();

    const { data: user } = await octokit.users.getAuthenticated();
    console.log(`✅ Connected as ${user.login}`);

    const repoName = 'hope-for-haven-hub-' + Date.now();
    console.log(`\n📦 Creating repository: ${repoName}...`);

    const { data: repo } = await octokit.repos.createForAuthenticatedUser({
      name: repoName,
      description: 'Hope For Haven Hub - Community Resource Platform',
      private: false,
      auto_init: true
    });
    console.log(`✅ Repository created: ${repo.html_url}`);
    console.log('⏳ Waiting for repository initialization...');
    await new Promise(resolve => setTimeout(resolve, 5000));

    console.log('\n📁 Reading project files...');
    const files = await getAllFiles(process.cwd());
    console.log(`Found ${files.length} files to upload`);

    console.log('\n🚀 Uploading files to GitHub...');
    
    const { data: mainRef } = await octokit.git.getRef({
      owner: user.login,
      repo: repoName,
      ref: 'heads/main'
    });

    const { data: mainCommit } = await octokit.git.getCommit({
      owner: user.login,
      repo: repoName,
      commit_sha: mainRef.object.sha
    });

    const fileBlobs = await Promise.all(
      files.map(async (file) => {
        const { data: blob } = await octokit.git.createBlob({
          owner: user.login,
          repo: repoName,
          content: Buffer.from(file.content).toString('base64'),
          encoding: 'base64'
        });
        return {
          path: file.path,
          mode: '100644' as const,
          type: 'blob' as const,
          sha: blob.sha
        };
      })
    );

    const { data: tree } = await octokit.git.createTree({
      owner: user.login,
      repo: repoName,
      base_tree: mainCommit.tree.sha,
      tree: fileBlobs
    });

    const { data: commit } = await octokit.git.createCommit({
      owner: user.login,
      repo: repoName,
      message: 'Upload Hope For Haven Hub - Complete Community Resource Platform',
      tree: tree.sha,
      parents: [mainRef.object.sha]
    });

    await octokit.git.updateRef({
      owner: user.login,
      repo: repoName,
      ref: 'heads/main',
      sha: commit.sha
    });

    console.log('\n✅ Successfully pushed to GitHub!');
    console.log(`🌐 Repository URL: ${repo.html_url}`);
    console.log(`📊 Commit SHA: ${commit.sha}`);
    
  } catch (error: any) {
    console.error('❌ Error:', error.message);
    if (error.response) {
      console.error('Response:', error.response.data);
    }
    process.exit(1);
  }
}

main();
