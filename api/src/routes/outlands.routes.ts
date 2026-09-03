import Router from 'express';

import { outlandsController } from '../controllers';

/**
 * OUTLANDS-2B. Scheduled-match routes.
 *
 * `enter` is the trusted password check every match entry must pass. The two
 * `passwords` routes are the Outlands Chief's administration, and neither of
 * them can return a stored value - only whether one is set.
 */
const outlandsRoutes = Router();

outlandsRoutes.post('/match/enter',
  (request, response) => outlandsController.enterMatch(request, response));
outlandsRoutes.get('/match/passwords',
  (request, response) => outlandsController.getMatchPasswordStatus(request, response));
outlandsRoutes.put('/match/passwords',
  (request, response) => outlandsController.updateMatchPasswords(request, response));

export { outlandsRoutes };
