using Microsoft.AspNetCore.Mvc;
using PlaywrightRecorder.Api.Models;
using PlaywrightRecorder.Api.Services;

namespace PlaywrightRecorder.Api.Controllers;

[ApiController]
[Route("api/project")]
public class ProjectController : ControllerBase
{
    private readonly IProjectService _projects;
    private readonly IFileTreeService _tree;

    public ProjectController(IProjectService projects, IFileTreeService tree)
    {
        _projects = projects;
        _tree = tree;
    }

    [HttpPost("new")]
    public ActionResult<ProjectInfo> CreateNew([FromBody] NewProjectRequest req)
    {
        var info = _projects.Scaffold(req);
        return Ok(info);
    }

    [HttpPost("load")]
    public ActionResult<ProjectInfo> Load([FromBody] LoadProjectRequest req)
    {
        var info = _projects.Load(req);
        return Ok(info);
    }

    [HttpGet("current")]
    public ActionResult<ProjectInfo?> Current() => Ok(_projects.Current);

    [HttpGet("tree")]
    public ActionResult<TreeNode> Tree()
    {
        var current = _projects.Current;
        if (current is null) return BadRequest("No project loaded.");
        return Ok(_tree.BuildTree(current.SolutionDirectory));
    }
}
