import { useEffect, useState } from "react"
import { api } from "@/lib/api"
import type { ProjectState } from "@/lib/types"
import { AnnotatePage } from "@/pages/AnnotatePage"
import { StartPage } from "@/pages/StartPage"

export default function App() {
  const [project, setProject] = useState<ProjectState | null>(null)
  const [checked, setChecked] = useState(false)

  // A reload of the page (in development) finds the project Go still holds.
  useEffect(() => {
    api
      .currentProject()
      .then(setProject)
      .catch(() => setProject(null))
      .finally(() => setChecked(true))
  }, [])

  if (!checked) return null
  if (!project) return <StartPage onOpen={setProject} />
  return (
    <AnnotatePage
      key={project.info.dir}
      project={project}
      onProjectChange={setProject}
      onClose={() => {
        void api.closeProject().then(() => setProject(null))
      }}
    />
  )
}
