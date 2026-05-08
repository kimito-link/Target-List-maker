import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: 'ANTHROPIC_API_KEY が未設定です。Vercel の環境変数をご確認ください。' },
      { status: 500 }
    );
  }

  // 簡易パスワード認証 (APP_PASSWORD が設定されている場合のみ)
  const password = process.env.APP_PASSWORD;
  if (password) {
    const provided = req.headers.get('x-app-password');
    if (provided !== password) {
      return NextResponse.json({ error: '認証エラー' }, { status: 401 });
    }
  }

  let body: { name?: string; pref?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { name, pref } = body;
  if (!name || !pref) {
    return NextResponse.json({ error: 'name と pref が必要です' }, { status: 400 });
  }

  const prompt = `${pref}にある以下の法人について、公式サイトのURLと代表電話番号を調べ、JSONで返してください。

法人名: ${name}
都道府県: ${pref}

【絶対ルール】
- 出力はJSONオブジェクト 1 つだけ。前後に説明文を一切書かない。
- 形式: {"url": "...", "phone": "..."}
- 公式サイト: 法人格 (株式会社/有限/合資/医療法人 等) が一致するもののみ。タウンページ、NAVITIME、Wikipedia、求人サイト、口コミ、法人DB (houjin.jp / baseconnect 等) は不可。
- 電話番号: 固定電話の代表番号 (例: 0738-22-4123)。FAX は不可。市外局番のハイフン区切り推奨。
- 同名異社に注意。確信が持てなければ空文字 "" を返す。`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }],
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      return NextResponse.json(
        { error: `Anthropic API ${response.status}: ${errText.slice(0, 200)}` },
        { status: response.status }
      );
    }

    const data = await response.json();
    const fullText: string = (data.content || [])
      .filter((b: { type: string }) => b.type === 'text')
      .map((b: { text: string }) => b.text)
      .join('\n');

    // JSON 抽出 (後ろから順に試す。最終回答は末尾にあることが多い)
    const cleaned = fullText.replace(/```json|```/g, '');
    const jsonMatches = [...cleaned.matchAll(/\{[\s\S]*?\}/g)];
    let parsed: { url?: string; phone?: string } | null = null;
    for (const m of jsonMatches.reverse()) {
      try {
        const obj = JSON.parse(m[0]);
        if ('url' in obj || 'phone' in obj) {
          parsed = obj;
          break;
        }
      } catch {
        /* 次の候補へ */
      }
    }

    // フォールバック: テキストから直接 URL / 電話番号抽出
    if (!parsed) {
      const urlMatch = fullText.match(/https?:\/\/[^\s"'<>)\]、。]+/);
      const phoneMatch = fullText.match(/0\d{1,4}-\d{1,4}-\d{3,4}/);
      parsed = {
        url: urlMatch ? urlMatch[0] : '',
        phone: phoneMatch ? phoneMatch[0] : '',
      };
    }

    return NextResponse.json({
      url: (parsed.url || '').toString().trim(),
      phone: (parsed.phone || '').toString().trim(),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
