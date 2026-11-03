using Microsoft.AspNetCore.Mvc;
using PlaywrightRecorder.Api.Models;
using PlaywrightRecorder.Api.Services;

namespace PlaywrightRecorder.Api.Controllers;

[ApiController]
[Route("api/codegen")]
public class CodegenController : ControllerBase
{
    private readonly ICodeGenerationService _codegen;

    public CodegenController(ICodeGenerationService codegen) => _codegen = codegen;

    [HttpPost("testclass")]
    public ActionResult<GeneratedFileResult> TestClass([FromBody] GenerateTestClassRequest req)
        => Ok(_codegen.GenerateTestClass(req));

    [HttpPost("testmethod")]
    public ActionResult<GeneratedFileResult> TestMethod([FromBody] GenerateTestMethodRequest req)
        => Ok(_codegen.AddTestMethod(req));

    [HttpPost("pageobject")]
    public ActionResult<IEnumerable<GeneratedFileResult>> PageObject([FromBody] GeneratePageObjectRequest req)
        => Ok(_codegen.GeneratePageObject(req));
}
