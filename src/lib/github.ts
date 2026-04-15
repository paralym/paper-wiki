const REPO = 'paralym/paper-wiki';

function headers() {
  return {
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

export async function getFile(path: string): Promise<{ content: string; sha: string } | null> {
  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
    headers: headers(),
    cache: 'no-store',
  });
  if (!res.ok) return null;
  const data = await res.json();
  const content = Buffer.from(data.content, 'base64').toString('utf-8');
  return { content, sha: data.sha };
}

export async function putFile(path: string, content: string, message: string, sha?: string): Promise<void> {
  const body: Record<string, string> = {
    message,
    content: Buffer.from(content).toString('base64'),
  };
  if (sha) body.sha = sha;

  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
    method: 'PUT',
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`GitHub API error: ${res.status} ${err}`);
  }
}

export async function deleteFile(path: string, message: string): Promise<boolean> {
  const file = await getFile(path);
  if (!file) return false;

  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
    method: 'DELETE',
    headers: headers(),
    body: JSON.stringify({ message, sha: file.sha }),
  });
  return res.ok;
}

export async function listDir(path: string): Promise<{ name: string; path: string }[]> {
  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
    headers: headers(),
    cache: 'no-store',
  });
  if (!res.ok) return [];
  const data = await res.json();
  if (!Array.isArray(data)) return [];
  return data.map((f: { name: string; path: string }) => ({ name: f.name, path: f.path }));
}
