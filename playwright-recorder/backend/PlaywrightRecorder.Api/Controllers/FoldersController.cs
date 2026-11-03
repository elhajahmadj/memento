using Microsoft.AspNetCore.Mvc;
using PlaywrightRecorder.Api.Models;
using PlaywrightRecorder.Api.Services;

namespace PlaywrightRecorder.Api.Controllers;

[ApiController]
[Route("api/folders")]
public class FoldersController : ControllerBase
{
    private readonly IProjectService _projects;
    private readonly IFileTreeService _tree;

    public FoldersController(IProjectService projects, IFileTreeService tree)
    {
        _projects = projects;
        _tree = tree;
    }

    private string Root() => _projects.Current?.SolutionDirectory
        ?? throw new InvalidOperationException("No project loaded.");

    [HttpPost("create")]
    public ActionResult Create([FromBody] CreateFolderRequest req)
    {
        _tree.EnsureInsideProject(req.Path, Root());
        Directory.CreateDirectory(req.Path);
        return Ok();
    }

    [HttpDelete("delete")]
    public ActionResult Delete([FromQuery] string path)
    {
        _tree.EnsureInsideProject(path, Root());
        if (Directory.Exists(path)) Directory.Delete(path, recursive: true);
        return Ok();
    }

    [HttpPost("rename")]
    public ActionResult Rename([FromBody] RenameRequest req)
    {
        _tree.EnsureInsideProject(req.OldPath, Root());
        _tree.EnsureInsideProject(req.NewPath, Root());
        if (Directory.Exists(req.OldPath))
            Directory.Move(req.OldPath, req.NewPath);
        return Ok();
    }
}
