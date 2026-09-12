import Router from 'express';

import { avatarController} from '../controllers';

const avatarRoutes = Router();

avatarRoutes.get('', (request, response) => avatarController.getResults(request, response));
/*
 * The Outlands gameplay path. The five Outlands avatars are system resources
 * and are not in the ordinary library, so the entrance asks for them here.
 */
avatarRoutes.get('/outlands', (request, response) =>
  avatarController.getOutlandsTeamAvatars(request, response));
avatarRoutes.post('/outlands', (request, response) =>
  avatarController.wearOutlandsTeamAvatar(request, response));
avatarRoutes.get('/remove_all_avatars', (request, response) => 
  avatarController.removeAllAvatars(request, response));
avatarRoutes.post('/upload', (request, response) => avatarController.add(request, response));

export { avatarRoutes };
