import * as OpenCC from 'opencc-js/t2cn';

const traditionalToSimplified = OpenCC.Converter({ from: 'tw', to: 'cn' });

export function normalizeChineseScript(text: string, language = 'zh-CN') {
  const normalizedText = String(text || '');
  if (!normalizedText || !/^zh-CN$/i.test(language) || !/[\u4e00-\u9fff]/.test(normalizedText)) {
    return normalizedText;
  }
  return traditionalToSimplified(normalizedText);
}
