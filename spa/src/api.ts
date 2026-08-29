import axios from "axios";

import appStore from "./appStore";

// axios config
axios.interceptors.request.use(function (config) {
    config.headers.apiToken = appStore.data.user.token;
    config.headers.bid = localStorage.getItem("bid");
    return config;
});

/** Extra headers for one request, merged with what the interceptor above already sets. */
type RequestHeaders = Record<string, string>;

/*
 * NOTE on `post`'s third parameter: it is a `formData` FLAG, not an axios request config.
 * Passing a config object there -- the natural thing to try, since that IS axios's own
 * signature -- silently sends the body as multipart FormData and drops the config entirely.
 * The Bank's `Idempotency-Key` was written that way once and the header never left the
 * browser. Nothing but a real request could have caught it, because every server-side test
 * calls the service directly. `headers` is therefore a FOURTH parameter, not a widening of
 * the third.
 */
const api = {
    get: <T>(endpoint: string, data?: any) => {
        return axios.get<T>("/api" + endpoint, {
            params: data,
        });
    },
    post: <T>(endpoint: string, data?: any, formData?: boolean, headers?: RequestHeaders) => {
        if (formData) {
            var postData = new FormData();
            Object.keys(data).forEach((key) => postData.append(key, data[key]));
            return axios.post<T>("/api" + endpoint, postData, headers ? { headers } : undefined);
        } else {
            return axios.post<T>("/api" + endpoint, data, headers ? { headers } : undefined);
        }
    },
};
export default api;
