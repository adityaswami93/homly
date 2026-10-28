// Signed Storage URLs keep the object path, so a PDF (WhatsApp lets people
// send vouchers and letters as PDFs) is recognisable before it's fetched.
export function isPdfUrl(url: string): boolean {
  return /\.pdf(\?|$)/i.test(url);
}
