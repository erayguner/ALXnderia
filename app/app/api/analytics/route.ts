import { handleAnalytics } from '../../../src/server/routes/analytics';

export async function GET() {
  return handleAnalytics();
}
