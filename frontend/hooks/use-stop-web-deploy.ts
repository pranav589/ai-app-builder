"use client"

import { useMutation } from "@tanstack/react-query"
import { apiClient, getApiErrorMessage } from "@/lib/api-client"

/**
 * Marks the in-flight web deployment as failed so a stuck one stops blocking new deploys.
 * No refetch here: the status stream reports the change and refetches the deploy query.
 */
export function useStopWebDeploy(projectId: string, onError?: (message: string) => void) {
  return useMutation({
    mutationFn: async () => (await apiClient.delete(`/api/projects/${projectId}/publish/web`)).data,
    onError: (err) => onError?.(getApiErrorMessage(err, "Couldn't stop the deployment.")),
  })
}
